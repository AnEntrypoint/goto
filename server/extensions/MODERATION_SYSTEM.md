# BUG #1890: Moderation System Framework

## Overview
Framework for content moderation, player conduct enforcement, and handling reports of harassment, cheating, and violations.

## User Stories
- Players report rule violations by other players
- Moderators investigate and enforce punishments
- Automated systems catch obvious violations
- Appeals process for disputed bans
- Transparency in moderation decisions
- Community guidelines clearly defined

## Technical Requirements
- **Report system**: Players report violations with evidence
- **Evidence preservation**: Screenshots, replays of violations
- **Automated detection**: Catch spam, harassment, suspicious patterns
- **Manual review**: Moderators investigate serious violations
- **Enforcement**: Apply mutes, bans, content removal
- **Appeals**: Players can dispute moderation decisions
- **Audit trail**: Log all moderation actions
- **Transparency**: Show players why they were actioned

## Data Schema
```sql
CREATE TABLE moderation_reports (
  id UUID PRIMARY KEY,
  reporter_id VARCHAR(256) NOT NULL,
  reported_id VARCHAR(256) NOT NULL,
  report_type VARCHAR(32) NOT NULL,
  description TEXT,
  evidence JSON,
  created_at BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  CHECK(status IN ('submitted', 'reviewing', 'confirmed', 'rejected'))
);

CREATE TABLE player_actions (
  id UUID PRIMARY KEY,
  player_id VARCHAR(256) NOT NULL,
  action_type VARCHAR(16) NOT NULL,
  duration_ms INT,
  reason TEXT,
  applied_by VARCHAR(256) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  CHECK(action_type IN ('warning', 'mute', 'ban', 'suspension'))
);

CREATE TABLE moderation_queue (
  id UUID PRIMARY KEY,
  report_id UUID NOT NULL,
  assignee_id VARCHAR(256),
  priority INT DEFAULT 5,
  created_at BIGINT NOT NULL,
  due_at BIGINT NOT NULL,
  FOREIGN KEY(report_id) REFERENCES moderation_reports(id)
);

CREATE TABLE appeals (
  id UUID PRIMARY KEY,
  action_id UUID NOT NULL,
  player_id VARCHAR(256) NOT NULL,
  appeal_text TEXT,
  status VARCHAR(16) NOT NULL,
  decision TEXT,
  decided_by VARCHAR(256),
  created_at BIGINT NOT NULL,
  FOREIGN KEY(action_id) REFERENCES player_actions(id),
  CHECK(status IN ('submitted', 'reviewing', 'upheld', 'overturned', 'rejected'))
);
```

## Report Types
- **Harassment**: Insults, bullying, toxic behavior
- **Cheating**: Suspected hacking or exploits
- **Spam**: Repeated unwanted messages
- **Offensive content**: Hate speech, discrimination
- **Exploitation**: Unfair play, griefing
- **Account sharing**: Suspicious account activity
- **Copyright**: Illegal UGC or content

## Automated Detection Rules
```javascript
const AUTO_DETECT = {
  spam: {
    threshold: '5 messages in 10 seconds',
    action: 'mute 1 hour'
  },
  profanity: {
    keywords: ['...'],
    action: 'censor + warning'
  },
  repeated_reports: {
    threshold: '>3 reports in 24h',
    action: 'review priority'
  },
  cheating_patterns: {
    impossible_stats: 'wins with 0 deaths',
    action: 'flag for review'
  },
  rate_limiting: {
    threshold: '>100 API calls/sec',
    action: 'ip ban 1 hour'
  }
}
```

## Enforcement Actions
- **Warning**: First-time minor violations, no gameplay restriction
- **Mute**: Prevent chat messaging for duration (1h - 7d)
- **Suspension**: Prevent all gameplay for duration (1d - 30d)
- **Ban**: Permanent removal from game (appealable)
- **Content removal**: Delete offending content
- **Account reset**: Wipe progression (severe violations)

## API Surface
```javascript
class ModerationService {
  // Reporting
  submitReport(reporterId, reportedId, reportType, description, evidence) -> { reportId }
  getReport(reportId) -> { fullReport }
  getMyReports(playerId) -> [reports]

  // Moderation queue
  getModerationQueue(status = 'submitted') -> [reports]
  assignReport(reportId, moderatorId) -> void
  closeReport(reportId, decision, actionIfNeeded) -> void

  // Enforcement
  applyAction(playerId, actionType, duration, reason, moderatorId) -> { actionId }
  removeAction(actionId, reason, moderatorId) -> void
  getPlayerActions(playerId) -> [{ action, duration, expires, reason }]

  // Appeals
  submitAppeal(actionId, appealText) -> { appealId }
  getAppeals(status = 'submitted') -> [appeals]
  respondToAppeal(appealId, decision, reasoning) -> void

  // Statistics
  getModerationStats(days = 30) -> { reports, actions, appeal_rate }
  getModeratorStats(moderatorId) -> { reports_handled, appeal_rate }
  getPlayerHistor(playerId) -> [{ action, date, reason, status }]

  // Rules
  getCommunityGuidelines() -> { text, lastUpdated }
  reportAppeal(appealId, reason) -> void
}
```

## Moderation Workflow
1. Player submits report with evidence
2. Report appears in moderation queue
3. Moderator reviews report and evidence
4. Moderator makes decision (action or dismiss)
5. Action applied automatically (mute, ban)
6. Reported player notified of action
7. Reported player can appeal within 7 days
8. Appeal reviewed by different moderator
9. Final decision upheld or overturned

## Appeal Process
- **Appeal window**: 7 days after action applied
- **New evidence**: Can submit additional evidence
- **Different reviewer**: Not original moderator
- **Consistency check**: Compare with similar cases
- **Turnaround time**: 3-5 business days for decision

## Transparency
- Players see why they were actioned
- Moderation reasons public (not internal discussion)
- Appeal decisions explained
- Statistics on moderation published monthly
- Clear community guidelines

## Integration Points
- **ChatService**: Flag suspicious messages
- **GameServer**: Enforce mutes/bans at login
- **ReportingService**: Collect player reports
- **AppealService**: Handle appeals
- **AnalyticsService**: Track moderation trends
- **NotificationService**: Alert players of actions

## Implementation Roadmap (Future)
1. Design moderation system
2. Implement report submission
3. Build moderation queue
4. Create enforcement actions
5. Implement appeals process
6. Add automation rules
7. Build moderator UI

## Dependencies
- Moderation database
- Report evidence storage
- Decision logging system
- Appeal tracking
- Moderator tools UI

## Risk Assessment
- **Moderator bias**: Inconsistent enforcement of rules
- **False positives**: Innocent players wrongly actioned
- **Appeals spam**: Players abuse appeals process
- **Harassment of mods**: Players target moderation team
- **Corruption**: Moderators abuse power

## Alternatives Considered
- **Community voting**: Players vote on violations (mob justice)
- **Automated only**: No human review (cold and error-prone)
- **No appeals**: Simpler but unjust for false positives
