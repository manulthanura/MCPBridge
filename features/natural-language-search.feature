Feature: Natural language data search
  As an AI assistant user
  I want to ask questions about the data in plain language
  So that I can analyze data without writing SQL

  Background:
    Given the MCPBridge server is connected to a PostgreSQL database
    And the connected MCP client supports sampling

  Scenario: Answer a natural language question
    When the assistant calls "search_data" with question "How many orders were placed last month?"
    Then a compact schema description is assembled from the schema cache
    And the client's own model is asked via MCP sampling to write one read-only SELECT
    And the generated SQL is validated by the same safety pipeline as query_db
    And the query is executed with the standard result limit
    And the response shows BOTH the generated SQL and the results

  Scenario: Generate SQL for review without executing it
    When the assistant calls "search_data" with execute=false
    Then the generated SQL is returned
    And the query is NOT executed
    And the response suggests running it via "query_db"

  Scenario: Reject unsafe generated SQL
    Given the model generates SQL containing a write statement
    When the generated SQL is validated
    Then the request fails with error "query_blocked"
    And the rejected SQL is included in the error details for transparency
    And the rejection is recorded in the audit trail

  Scenario: Sampling not supported by the client
    Given the connected MCP client does not support sampling
    When the assistant calls "search_data"
    Then the request fails with error "sql_generation_failed"
    And the hint suggests writing the SQL manually with "query_db"

  Scenario: Model response wrapped in prose and code fences
    Given the model replies with explanation text around a fenced SQL block
    When the SQL is extracted
    Then only the SQL statement inside the fence is used
