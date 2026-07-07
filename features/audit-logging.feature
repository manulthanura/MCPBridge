Feature: Audit trail for every database operation
  As a database administrator
  I want every operation logged with metadata
  So that I can track usage and investigate incidents

  Scenario: Log a successful query with full metadata
    When the assistant executes a query via "query_db"
    Then exactly one audit entry is appended containing:
      | field           | content                              |
      | timestamp       | ISO 8601 format                      |
      | tool            | query_db                             |
      | sql             | the executed SQL                     |
      | executionTimeMs | duration in milliseconds             |
      | rowsReturned    | count of result rows                 |
      | clientId        | name of the connected MCP client     |
      | status          | success                              |

  Scenario Outline: Every outcome is audited
    When an operation ends with outcome "<outcome>"
    Then the audit entry has status "<status>"

    Examples:
      | outcome                     | status       |
      | successful execution        | success      |
      | validation rejection        | blocked      |
      | database error              | error        |
      | rate limit rejection        | rate_limited |

  Scenario: Credentials never reach the audit log
    Given the database password appears in a connection error message
    When the error is written to the audit trail
    Then the password is replaced with "[REDACTED]"
    And connection-string passwords are also scrubbed

  Scenario: Audit log rotation prevents disk exhaustion
    Given the audit log file has reached 10 MB
    When the next entry is written
    Then the current log is rotated to a ".1" suffix
    And logging continues in a fresh file

  Scenario: Audit failures never break request serving
    Given the audit log file is not writable
    When the assistant executes a query
    Then the query still completes normally
    And the audit failure is reported on stderr

  @planned
  Scenario: Track query patterns for anomaly detection
    Given 500 queries have been logged in the past hour
    When the anomaly detector runs over the audit trail
    Then unusual patterns are flagged:
      | pattern                             | alert level |
      | 50+ queries to same table in 1 min  | warning     |
      | sequential scanning of all user IDs | high        |
      | unusual access time (3 AM)          | info        |
