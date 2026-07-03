/**
 * Server-side Google Maps Platform client: geocoding, Street View metadata
 * (capture date + camera position), Street View / satellite static images,
 * and zip-code address discovery. All fetches happen server-side — no
 * CORS proxy workarounds.
 */
import type { AddressInfo, PropertyImage, StreetViewMeta } from "./types.ts";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const SV_META_URL = "https://maps.googleapis.com/maps/api/streetview/metadata";
const SV_IMAGE_URL = "https://maps.googleapis.com/maps/api/streetview";
const STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap";

export interface GoogleClient {
  geocode(address: string): Promise<AddressInfo | null>;
  streetViewMetadata(lat: number, lng: number): Promise<StreetViewMeta>;
  fetchImages(info: AddressInfo, meta: StreetViewMeta): Promise<PropertyImage[]>;
  discoverAddresses(zip: string, limit: number): Promise<AddressInfo[]>;
}

async function fetchJsonWithRetry(url: string): Promise<any> {
  const delays = [2000, 4000, 8000, 16000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < delays.length) {
      await Bun.sleep(delays[attempt]);
      continue;
    }
    throw new Error(`Google API ${res.status} for ${url.split("?")[0]}`);
  }
}

async function fetchImage(
  url: string,
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch ${res.status} for ${url.split("?")[0]}`);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    base64: buf.toString("base64"),
    mediaType: type.includes("png") ? "image/png" : "image/jpeg",
  };
}

/** Compass bearing (degrees) from point A to point B. */
export function bearing(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(toLng - fromLng);
  const y = Math.sin(dLng) * Math.cos(toRad(toLat));
  const x =
    Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
    Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function zipFromComponents(components: any[]): string | null {
  for (const c of components ?? []) {
    if (c.types?.includes("postal_code")) return c.short_name ?? c.long_name;
  }
  return null;
}

export function createGoogleClient(apiKey: string): GoogleClient {
  return {
    async geocode(address) {
      const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${apiKey}`;
      const data = await fetchJsonWithRetry(url);
      const result = data.results?.[0];
      if (data.status !== "OK" || !result) return null;
      return {
        address: result.formatted_address,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        zip: zipFromComponents(result.address_components),
      };
    },

    async streetViewMetadata(lat, lng) {
      const url = `${SV_META_URL}?location=${lat},${lng}&source=outdoor&key=${apiKey}`;
      const data = await fetchJsonWithRetry(url);
      return {
        status: data.status,
        panoId: data.pano_id ?? null,
        captureDate: data.date ?? null,
        lat: data.location?.lat ?? null,
        lng: data.location?.lng ?? null,
      };
    },

    async fetchImages(info, meta) {
      const images: PropertyImage[] = [];

      if (meta.status === "OK" && meta.panoId) {
        // Aim the camera at the building: heading from the pano's actual
        // position toward the geocoded rooftop point, ±25° for context —
        // avoids staring at the neighbor's fence.
        const head =
          meta.lat != null && meta.lng != null
            ? bearing(meta.lat, meta.lng, info.lat, info.lng)
            : 0;
        for (const offset of [-25, 0, 25]) {
          const heading = Math.round((head + offset + 360) % 360);
          const url = `${SV_IMAGE_URL}?size=640x400&pano=${meta.panoId}&heading=${heading}&fov=80&pitch=5&key=${apiKey}`;
          const img = await fetchImage(url);
          images.push({ kind: "street_view", heading, ...img });
        }
      }

      const satUrl = `${STATIC_MAP_URL}?center=${info.lat},${info.lng}&zoom=20&size=640x640&maptype=satellite&key=${apiKey}`;
      try {
        const sat = await fetchImage(satUrl);
        images.push({ kind: "satellite", ...sat });
      } catch {
        // satellite tile unavailable — street view alone can still be scored
      }

      return images;
    },

    /**
     * Zip-code address discovery via reverse-geocode grid sampling: geocode
     * the zip to get its viewport, walk a grid across it, reverse-geocode
     * each point and keep street_address/premise results inside the zip.
     * Cheap and key-only; swap for a parcel dataset in a later phase.
     */
    async discoverAddresses(zip, limit) {
      const url = `${GEOCODE_URL}?address=${encodeURIComponent(zip)}&components=postal_code:${encodeURIComponent(zip)}&key=${apiKey}`;
      const data = await fetchJsonWithRetry(url);
      const geom = data.results?.[0]?.geometry;
      const bounds = geom?.bounds ?? geom?.viewport;
      if (data.status !== "OK" || !bounds) {
        throw new Error(`Could not geocode zip ${zip}: ${data.status}`);
      }
      const { northeast: ne, southwest: sw } = bounds;

      const seen = new Set<string>();
      const found: AddressInfo[] = [];
      const steps = 14; // 14x14 grid ≈ 196 reverse geocodes max per zip
      for (let i = 0; i <= steps && found.length < limit; i++) {
        for (let j = 0; j <= steps && found.length < limit; j++) {
          const lat = sw.lat + ((ne.lat - sw.lat) * i) / steps;
          const lng = sw.lng + ((ne.lng - sw.lng) * j) / steps;
          const rev = await fetchJsonWithRetry(
            `${GEOCODE_URL}?latlng=${lat},${lng}&result_type=street_address|premise&key=${apiKey}`,
          );
          for (const r of rev.results ?? []) {
            const rZip = zipFromComponents(r.address_components);
            if (rZip !== zip || seen.has(r.formatted_address)) continue;
            seen.add(r.formatted_address);
            found.push({
              address: r.formatted_address,
              lat: r.geometry.location.lat,
              lng: r.geometry.location.lng,
              zip: rZip,
            });
            break; // one address per grid point
          }
          await Bun.sleep(60); // stay under geocoding QPS limits
        }
      }
      return found;
    },
  };
}
