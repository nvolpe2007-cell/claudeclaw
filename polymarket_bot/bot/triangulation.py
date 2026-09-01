from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from bot.scanner import Opportunity

logger = logging.getLogger(__name__)


@dataclass
class MarketNode:
    token_id: str
    question: str
    mid: float = 0.5  # current mid-price
    fair_value: float = 0.5  # triangulated fair value
    volume_24h: float = 0.0
    last_update: float = 0.0
    threshold: float | None = None  # e.g., 100000 for "BTC > $100k"


class MarketGraph:
    """Build and maintain a graph of related BTC markets to triangulate fair values."""

    def __init__(self) -> None:
        self.nodes: dict[str, MarketNode] = {}
        self.edges: dict[str, list[str]] = {}  # token_id → list of related token_ids

    def add_market(self, opp: Opportunity) -> None:
        """Add or update a market from an Opportunity."""
        token_id = opp.token_id_yes
        if token_id not in self.nodes:
            threshold = self._extract_threshold(opp.question)
            self.nodes[token_id] = MarketNode(
                token_id=token_id,
                question=opp.question,
                threshold=threshold,
            )
            self.edges[token_id] = []

        node = self.nodes[token_id]
        node.mid = opp.mid
        node.volume_24h = opp.volume_24h

        # Link to related markets
        self._link_related_markets(token_id)

    def update_fair_values(self) -> None:
        """Recompute fair values via triangulation."""
        for token_id in self.nodes:
            self.nodes[token_id].fair_value = self._compute_fair_value(token_id)

    def get_fair_value(self, token_id: str) -> float:
        """Return triangulated fair value for a token."""
        if token_id not in self.nodes:
            return 0.5
        return self.nodes[token_id].fair_value

    def get_node(self, token_id: str) -> MarketNode | None:
        return self.nodes.get(token_id)

    # -------------------------------------------------------------------------
    # Private methods
    # -------------------------------------------------------------------------

    def _extract_threshold(self, question: str) -> float | None:
        """Extract numeric threshold from question string.

        E.g., "Will BTC be above $100,000 by Dec 31?" → 100000.0
        """
        # Look for common patterns: $X,XXX or $X.XX
        match = re.search(r'\$[\d,]+(?:\.\d+)?', question)
        if match:
            val_str = match.group().replace('$', '').replace(',', '')
            try:
                return float(val_str)
            except ValueError:
                pass
        return None

    def _link_related_markets(self, token_id: str) -> None:
        """Find and link all markets related to this token."""
        node = self.nodes[token_id]
        if not node.threshold:
            return

        # Extract base event (e.g., "BTC" from "Will BTC be above $100k")
        base_event = self._extract_base_event(node.question)

        # Find all other markets with same base event
        related = []
        for other_id, other_node in self.nodes.items():
            if other_id == token_id:
                continue
            other_base = self._extract_base_event(other_node.question)
            if base_event and other_base and base_event.lower() == other_base.lower():
                related.append(other_id)

        self.edges[token_id] = related

    def _extract_base_event(self, question: str) -> str | None:
        """Extract base event from question.

        E.g., "Will BTC be above..." → "BTC"
        """
        match = re.search(r'\b(BTC|Bitcoin|ETH|Ethereum)\b', question, re.IGNORECASE)
        if match:
            return match.group(1)
        return None

    def _compute_fair_value(self, token_id: str) -> float:
        """Triangulate fair value from related markets.

        Logic:
        - If market A (BTC > $100k) and market B (BTC > $95k) exist,
          then A should be ≤ B (logically).
        - Fair value of A ≈ weighted average of B and other related markets.
        """
        node = self.nodes[token_id]
        related_ids = self.edges.get(token_id, [])

        if not related_ids:
            # No related markets — use current mid as fair value
            return node.mid

        # Get mid prices of related markets
        related_mids = []
        related_volumes = []
        for rid in related_ids:
            if rid in self.nodes:
                rnode = self.nodes[rid]
                related_mids.append(rnode.mid)
                related_volumes.append(rnode.volume_24h)

        if not related_mids:
            return node.mid

        # Weight by volume (higher volume = more reliable)
        if sum(related_volumes) > 0:
            weighted_mid = sum(m * v for m, v in zip(related_mids, related_volumes)) / sum(related_volumes)
        else:
            weighted_mid = sum(related_mids) / len(related_mids)

        # Smooth between current mid and weighted mid (80% weighted, 20% current)
        # This prevents dramatic swings if triangulation is noisy
        fair_value = 0.8 * weighted_mid + 0.2 * node.mid
        return min(1.0, max(0.0, fair_value))
