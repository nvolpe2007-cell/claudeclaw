from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.config import Config
    from bot.triangulation import MarketGraph

logger = logging.getLogger(__name__)


@dataclass
class Opportunity:
    """Represents a mispriced YES token."""

    token_id: str
    question: str
    side: str  # "BUY" | "SELL"
    current_price: float  # fractional (0–1)
    fair_value: float  # triangulated fair price
    mispricing_cents: float  # absolute deviation in cents
    volume_24h: float
    strength: float  # 0–1, how confident we are in the mispricing
    detected_at: float = 0.0


class OpportunityDetector:
    """Detects mispriced YES tokens via triangulation."""

    def __init__(self, graph: MarketGraph, config: Config) -> None:
        self._graph = graph
        self._config = config
        self._last_scan_time = 0.0

    async def find_opportunities(self) -> list[Opportunity]:
        """Scan all markets in the graph and return mispriced tokens."""
        self._graph.update_fair_values()

        opportunities: list[Opportunity] = []
        now = time.time()

        for token_id, node in self._graph.nodes.items():
            fair_value = node.fair_value
            current_price = node.mid
            mispricing_cents = abs(fair_value - current_price) * 100

            # Only report if mispricing is significant enough
            if mispricing_cents < self._config.min_mispricing_cents:
                continue

            # Determine side: BUY if undervalued, SELL if overvalued
            side = "BUY" if current_price < fair_value else "SELL"

            # Strength = confidence in the mispricing
            # Higher volume + larger mispricing = higher confidence
            strength = min(
                1.0,
                (mispricing_cents / self._config.min_mispricing_cents)
                * (node.volume_24h / 100_000.0),
            )

            opp = Opportunity(
                token_id=token_id,
                question=node.question,
                side=side,
                current_price=current_price,
                fair_value=fair_value,
                mispricing_cents=mispricing_cents,
                volume_24h=node.volume_24h,
                strength=strength,
                detected_at=now,
            )
            opportunities.append(opp)

        # Sort by strength descending (strongest opportunities first)
        opportunities.sort(key=lambda o: o.strength, reverse=True)

        if opportunities:
            logger.info(
                "Detected %d opportunities (top: %s, %.1fc mispricing)",
                len(opportunities),
                opportunities[0].question[:50],
                opportunities[0].mispricing_cents,
            )

        return opportunities
