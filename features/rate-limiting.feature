Feature: Per-client rate limiting
  As a database administrator
  I want tool usage rate-limited per client
  So that a misbehaving assistant cannot overload the database

  Background:
    Given the rate limit is 100 requests per 60-second sliding window

  Scenario: Requests within the limit pass
    When a client makes 100 tool calls within one minute
    Then all 100 requests are allowed

  Scenario: The 101st request in the window is rejected
    Given a client has made 100 tool calls in the current window
    When the client makes one more tool call
    Then the request is REJECTED with error "rate_limited"
    And the response includes the limit "100 per 60 seconds"
    And the response includes retry_after in seconds
    And no database connection is consumed for the rejected request
    And the rejection is recorded in the audit trail

  Scenario: Capacity returns as the window slides
    Given a client exhausted its limit 61 seconds ago
    When the client makes a new tool call
    Then the request is allowed

  Scenario: Clients are limited independently
    Given client "claude-desktop" has exhausted its limit
    When client "cursor" makes a tool call
    Then the request from "cursor" is allowed
