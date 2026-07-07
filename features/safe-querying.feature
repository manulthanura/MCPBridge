Feature: Safe read-only database querying
  As an AI assistant user
  I want to query the database through validated, limited, audited SQL
  So that I get accurate results without any risk of data corruption

  Background:
    Given the MCPBridge server is connected to a PostgreSQL database
    And the server is configured with a maximum result size of 100 rows

  Scenario: Execute a simple read query
    When the assistant calls "query_db" with sql "SELECT name, email FROM users WHERE id = 42"
    Then the query passes validation as a read-only SELECT
    And the query is executed inside a READ ONLY transaction
    And the result is returned as a markdown table
    And the execution time and row count are recorded in the audit trail

  Scenario: Block a dangerous statement on the read path
    When the assistant calls "query_db" with sql "DROP TABLE users"
    Then the request is REJECTED with error "query_blocked"
    And the reason states that DROP statements are not allowed
    And the blocked query is logged in the audit trail with status "blocked"
    And no database connection is used for execution

  Scenario: Redirect write statements to the guarded write tool
    When the assistant calls "query_db" with sql "DELETE FROM orders WHERE status = 'draft'"
    Then the request is REJECTED with error "query_blocked"
    And the hint tells the assistant to use the "write_db" tool instead

  Scenario: Block multi-statement injection payloads
    When the assistant calls "query_db" with sql "SELECT 1; DELETE FROM users"
    Then the request is REJECTED with error "query_blocked"
    And the reason states that multiple statements are not allowed

  Scenario: Block a write smuggled through a CTE
    When the assistant calls "query_db" with sql "WITH gone AS (DELETE FROM users RETURNING id) SELECT count(*) FROM gone"
    Then the request is REJECTED with error "query_blocked"

  Scenario: Ignore dangerous keywords inside strings and comments
    When the assistant calls "query_db" with sql "SELECT note FROM audit WHERE note = 'DROP TABLE users' -- TRUNCATE nothing"
    Then the query passes validation
    And the string literal contents are not treated as SQL keywords

  Scenario: Prevent a query from returning excessive results
    When the assistant calls "query_db" with sql "SELECT * FROM orders"
    And the orders table has 89302 rows
    Then the query is MODIFIED to include "LIMIT 100"
    And the response contains a warning that the result was capped
    And the warning suggests adding a WHERE clause or pagination

  Scenario: Respect an explicit LIMIT written by the caller
    When the assistant calls "query_db" with sql "SELECT * FROM orders LIMIT 10"
    Then the query is executed unmodified

  Scenario: Execute an aggregation query
    When the assistant calls "query_db" with sql "SELECT status, COUNT(*), AVG(total) FROM orders GROUP BY status"
    Then the query passes validation
    And the result is formatted as a summary table
    And monetary values are formatted with 2 decimal places

  Scenario: Report a SQL syntax error clearly
    When the assistant calls "query_db" with sql "SELEC * FORM users WERE id = 42"
    Then the request fails with error "syntax_error"
    And the error details include the character position reported by PostgreSQL

  Scenario: Explain a query before running it
    When the assistant calls "explain_query" with a SELECT statement and analyze=false
    Then the response contains the estimated execution plan
    And the query itself is NOT executed
    And known performance smells such as sequential scans are surfaced as warnings

  Scenario: Refuse to explain a write statement
    When the assistant calls "explain_query" with sql "DELETE FROM orders"
    Then the request is REJECTED
    And the reason states that EXPLAIN ANALYZE would execute the statement
