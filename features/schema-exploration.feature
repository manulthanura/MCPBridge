Feature: Database schema exploration
  As an AI assistant user
  I want to explore the database structure through tools and resources
  So that I understand the data before querying it

  Background:
    Given the MCPBridge server is connected to a PostgreSQL database
    And the database contains tables: users, orders, products, reviews

  Scenario: List all tables with row estimates and descriptions
    When the assistant calls "list_tables"
    Then a table inventory is returned containing:
      | table    | kind  | estimated_rows | description                 |
      | users    | table | 15,420         | User accounts and profiles  |
      | orders   | table | 89,302         | Purchase orders             |
      | products | table | 2,341          | Product catalog             |
      | reviews  | table | 34,567         | Product reviews and ratings |
    And the row counts come from planner statistics, not COUNT(*)
    And the response arrives in under 1 second

  Scenario: Describe a table with keys, indexes and samples
    When the assistant calls "describe_table" with table "orders"
    Then the response includes the column list with types and nullability
    And the primary key is identified
    And every foreign key is listed as "column -> table.column"
    And all indexes are listed with uniqueness flags
    And up to 3 sample rows are included
    And column statistics show null fractions and distinct value counts

  Scenario: Describe a table that does not exist
    When the assistant calls "describe_table" with table "nonexistent"
    Then the request fails with error "table_not_found"
    And the hint suggests calling "list_tables" first

  Scenario: Explore relationships between tables
    When the assistant calls "describe_table" with table "orders"
    Then the relationship map includes:
      | relationship       | cardinality | via        |
      | orders -> users    | many-to-one | user_id    |
      | orders -> products | many-to-one | product_id |
      | reviews -> orders  | one-to-many | order_id   |

  Scenario: Read the schema as an MCP resource
    When the assistant reads the resource "schema://public"
    Then a complete JSON schema snapshot is returned
    And the snapshot includes all tables, columns, keys and indexes
    And the snapshot is served from a cache with a 5-minute TTL

  Scenario: Schema cache expires and refreshes
    Given the schema snapshot was cached more than 5 minutes ago
    When the assistant reads the resource "schema://public" again
    Then the snapshot is re-introspected from the database

  Scenario: Browse per-table resources
    When the assistant lists available resources
    Then each table is offered as "table://{name}", "stats://{table}" and "relations://{table}"
