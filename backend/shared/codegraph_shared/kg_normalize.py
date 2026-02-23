"""Shared KG extraction payload normalization."""

from __future__ import annotations

from typing import Any

_VALID_RELATION_TYPES: frozenset[str] = frozenset(
    {"defines", "uses", "depends_on", "calls", "inherits", "part_of", "related"}
)


def normalize_kg_extract(raw: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Normalize a raw LLM KG extraction payload into clean entity and relation lists.

    Returns:
        (entities, relations) where each entity is {name, type} and each
        relation is {source, target, relation_type, confidence, evidence}.
    """
    raw_entities = raw.get("entities", [])
    raw_relations = raw.get("relationships", [])
    entities: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []

    if isinstance(raw_entities, list):
        for item in raw_entities:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            entity_type = str(item.get("type", "unknown")).strip() or "unknown"
            entities.append({"name": name, "type": entity_type})

    if isinstance(raw_relations, list):
        for item in raw_relations:
            if not isinstance(item, dict):
                continue
            source = str(item.get("source", "")).strip()
            target = str(item.get("target", "")).strip()
            if not source or not target:
                continue
            relation_type = str(item.get("relation_type", "related")).strip().lower() or "related"
            if relation_type not in _VALID_RELATION_TYPES:
                relation_type = "related"
            evidence = str(item.get("evidence", "")).strip()
            try:
                confidence = float(item.get("confidence", 0.5))
            except (TypeError, ValueError):
                confidence = 0.5
            confidence = max(0.0, min(confidence, 1.0))
            relations.append(
                {
                    "source": source,
                    "target": target,
                    "relation_type": relation_type,
                    "confidence": confidence,
                    "evidence": evidence,
                }
            )

    return entities, relations
