-- Sample e-commerce schema for trying out MCPBridge.
CREATE TABLE users (
    id         serial PRIMARY KEY,
    name       text        NOT NULL,
    email      text        NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE users IS 'User accounts and profiles';

CREATE TABLE products (
    id    serial PRIMARY KEY,
    name  text           NOT NULL,
    price numeric(10, 2) NOT NULL CHECK (price >= 0)
);
COMMENT ON TABLE products IS 'Product catalog';

CREATE TABLE orders (
    id         serial PRIMARY KEY,
    user_id    integer        NOT NULL REFERENCES users (id),
    product_id integer        NOT NULL REFERENCES products (id),
    total      numeric(10, 2) NOT NULL,
    status     text           NOT NULL DEFAULT 'draft',
    created_at timestamptz    NOT NULL DEFAULT now()
);
COMMENT ON TABLE orders IS 'Purchase orders';
CREATE INDEX idx_orders_user_id ON orders (user_id);
CREATE INDEX idx_orders_status ON orders (status);

CREATE TABLE reviews (
    id       serial PRIMARY KEY,
    order_id integer NOT NULL REFERENCES orders (id),
    rating   integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body     text
);
COMMENT ON TABLE reviews IS 'Product reviews and ratings';

INSERT INTO users (name, email) VALUES
    ('Jane Smith', 'jane@example.com'),
    ('Ravi Perera', 'ravi@example.com'),
    ('中村 悠', 'yu@example.jp');

INSERT INTO products (name, price) VALUES
    ('Widget', 9.99),
    ('Gadget', 24.50),
    ('Doohickey 🎉', 3.75);

INSERT INTO orders (user_id, product_id, total, status) VALUES
    (1, 1, 9.99,  'completed'),
    (1, 2, 24.50, 'completed'),
    (2, 3, 3.75,  'draft'),
    (3, 1, 9.99,  'shipped');

INSERT INTO reviews (order_id, rating, body) VALUES
    (1, 5, 'Great widget!'),
    (2, 4, 'Solid gadget, fast shipping'),
    (4, 3, 'とても良い');

ANALYZE;
