Feature: Guarded write operations with confirmation flow
  As an AI assistant user
  I want data modifications to require explicit confirmation
  So that accidental or destructive mutations are prevented

  Background:
    Given the MCPBridge server is running in read-write mode
    And the high-risk threshold is 100 estimated rows
    And the confirmation timeout is 10 minutes

  Scenario: Stage an INSERT without executing it
    When the assistant calls "write_db" with sql "INSERT INTO products (name, price) VALUES ('Widget', 9.99)"
    Then the statement is NOT executed
    And a confirmation request is returned containing:
      | field                   | value                                  |
      | status                  | confirmation_required                  |
      | operation               | INSERT                                 |
      | target_table            | products                               |
      | estimated_affected_rows | 1                                      |
      | risk_level              | low                                    |
      | confirmation_id         | a unique id                            |
    And the affected-row estimate comes from EXPLAIN without ANALYZE

  Scenario: Confirm and execute a staged write
    Given a pending low-risk write with a known confirmation_id
    When the assistant calls "confirm_write" with that confirmation_id
    Then the statement is executed inside a transaction
    And the response reports status "success" and the rows affected
    And the confirmation is recorded in the audit trail

  Scenario: Reject a staged write
    Given a pending write with a known confirmation_id
    When the assistant calls "reject_write" with that confirmation_id
    Then the operation is cancelled and no data is modified
    And the rejection is recorded in the audit trail
    And a later "confirm_write" with the same id fails

  Scenario: Bulk delete requires double confirmation
    Given the planner estimates 1247 rows for "DELETE FROM orders WHERE status = 'draft'"
    When the assistant calls "write_db" with that statement
    Then the confirmation request has risk_level "high"
    And the risk reasons mention the estimated 1,247 affected rows
    When the assistant calls "confirm_write" without acknowledge_risk
    Then the request fails with error "risk_not_acknowledged"
    And nothing is executed
    When the assistant calls "confirm_write" with acknowledge_risk=true
    Then the delete is executed inside a transaction

  Scenario: UPDATE without WHERE is always high risk
    When the assistant calls "write_db" with sql "UPDATE products SET price = 0"
    Then the confirmation request has risk_level "high"
    And the risk reasons state that every row in the table is affected

  Scenario: Unconfirmed writes expire
    Given a write was staged 11 minutes ago and never confirmed
    When the assistant calls "confirm_write" with its confirmation_id
    Then the request fails because the pending write expired
    And the expired operation is recorded in the audit trail
    And nothing is executed

  Scenario: Writes are disabled in read-only mode
    Given the server is configured with MCPBRIDGE_MODE=read-only
    When the assistant calls "write_db" with any statement
    Then the request is REJECTED with a message about read-only mode
    And the hint explains how to enable read-write mode

  Scenario: DDL is never accepted on the write path
    When the assistant calls "write_db" with sql "DROP TABLE users"
    Then the request is REJECTED with error "query_blocked"
    And the reason states that schema changes belong in a migration workflow
