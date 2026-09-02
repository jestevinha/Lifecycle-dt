package com.inknow.manusim.model;

import java.util.HashMap;
import java.util.Map;

/**
 * Lightweight immutable event for simulation tracing.
 */
public class SimulationEvent {
    private final String type;          // e.g., SIM_START, SHIFT_START, UNIT_STATE_CHANGED, ...
    private final long timestampMin;    // absolute minutes since audit epoch (auditDay*1440 + dayMinute)
    private final Integer workareaId;   // optional
    private final String unitId;        // optional canonical id string
    private final Map<String, Object> payload; // optional small payload

    public SimulationEvent(String type, long timestampMin, Integer workareaId, String unitId, Map<String, Object> payload) {
        this.type = type;
        this.timestampMin = timestampMin;
        this.workareaId = workareaId;
        this.unitId = unitId;
        this.payload = (payload == null ? new HashMap<String, Object>() : payload);
    }

    public String getType() { return type; }
    public long getTimestampMin() { return timestampMin; }
    public Integer getWorkareaId() { return workareaId; }
    public String getUnitId() { return unitId; }
    public Map<String, Object> getPayload() { return payload; }
}
