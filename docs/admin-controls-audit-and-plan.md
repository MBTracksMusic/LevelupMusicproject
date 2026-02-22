# Admin Controls Audit + Additive Plan

This document captures the read-only audit and the additive implementation plan for:
- centralized admin audit logging
- rate limiting on sensitive RPCs
- monitoring and anomaly alerting

All changes are additive and keep existing RPC signatures unchanged.

## 1) AdminActionLogCoverage

| Action | Already logged in `ai_admin_actions` | Fields currently present | Gaps before this patch |
|---|---|---|---|
| `admin_validate_battle` | Yes (`battle_validate_admin`, and `battle_duration_set` when applicable) | `action_type`, `entity_type`, `entity_id`, `ai_decision`, `confidence_score`, `reason`, `status`, `executed_at`, `executed_by`, `error` | No centralized table, no normalized runtime context (`ip`, `user_agent`, `session_id`), no function-level summary event |
| `admin_cancel_battle` | Yes (`battle_cancel_admin`) | Same as above | Same gaps |
| `finalize_battle` | Admin path only (`battle_finalize_admin`) | Same as above | Service-role finalize path lacked admin-level centralized audit event |
| `admin_extend_battle_duration` | Yes (`battle_duration_extended`) | Same as above + extension fields in `ai_decision` | No centralized function-level audit event, no normalized runtime context |
| `finalize_expired_battles` | No direct centralized log (relies on downstream finalize) | N/A | No dedicated execution summary audit row |
| `agent_finalize_expired_battles` | Per-battle logs in `ai_admin_actions` (`battle_finalize`) | Same as above | No centralized wrapper execution summary, no rate-limit traces |

## 2) RPCRateLimitCandidates

| RPC | Current usage pattern | Recommended limit | Potential harm if abused |
|---|---|---|---|
| `admin_validate_battle` | Manual admin UI action | `20/min` per admin | Mass unintended activations, noisy logs, operational mistakes |
| `admin_cancel_battle` | Manual admin UI action | `20/min` per admin | Mass cancellations / business disruption |
| `admin_extend_battle_duration` | Manual admin UI action | `12/min` per admin | Timeline abuse / anti-competition manipulation |
| `finalize_battle` | Admin UI + service context | `30/min` per admin | Premature closures, ranking integrity issues |
| `finalize_expired_battles` | Cron/automation + admin fallback | `24/min` global | Hot-loop finalization jobs, DB contention |
| `agent_finalize_expired_battles` | Scheduled Edge orchestration | `24/min` global | Repeated orchestration loops, redundant writes |

## 3) Monitoring Inventory (Before Patch)

### Exists
- `ai_admin_actions` audit-like records for AI/admin decisions.
- `admin_notifications` for AI proposed actions.
- Edge function logs (console) visible in Supabase function logs.
- Generic `audit_logs` table exists in project for other domains.

### Missing / weak
- No centralized admin action table for cross-RPC incident review.
- No DB-native rate-limit counters/hits for admin RPCs.
- No standardized anomaly table for alerts (spikes, failed admin actions, limit hits).
- No unified function-level execution summary for `finalize_expired_battles` wrappers.

## 4) Anomalies to Detect

- RPC rate-limit exceed events (`rpc_rate_limit_exceeded`).
- Failed admin action events (`admin_action_failed`).
- Admin action spikes over 5 minutes (`admin_action_spike`).
- Periodic scan spikes over larger lookback windows (`admin_action_spike_scan`).

## 5) Implemented Additive Design

### New tables
- `public.admin_action_audit_log`
- `public.rpc_rate_limit_rules`
- `public.rpc_rate_limit_counters`
- `public.rpc_rate_limit_hits`
- `public.monitoring_alert_events`

### New helper functions
- `public.get_request_headers_jsonb()`
- `public.log_admin_action_audit(...)`
- `public.log_monitoring_alert(...)`
- `public.check_rpc_rate_limit(...)`
- `public.cleanup_rpc_rate_limit_counters(...)`
- `public.detect_admin_action_anomalies(...)`

### New triggers
- Sync executed `ai_admin_actions` to centralized audit log.
- Emit monitoring alert on rate-limit hit insert.
- Emit monitoring alert on failed admin action + action spike.

### RPC hardening (signatures unchanged)
- `admin_validate_battle`
- `admin_cancel_battle`
- `finalize_battle`
- `admin_extend_battle_duration`
- `finalize_expired_battles`
- `agent_finalize_expired_battles`

All keep existing business decisions and add:
- rate-limit guard
- centralized audit entries for success/guard failures

## 6) Operational Notes

- Limits are seeded defaults and can be tuned via `rpc_rate_limit_rules`.
- Monitoring alerts are persisted in DB (`monitoring_alert_events`) for admin triage.
- Scheduled housekeeping can run:
  - `SELECT public.cleanup_rpc_rate_limit_counters(48);`
  - `SELECT public.detect_admin_action_anomalies(15);`
