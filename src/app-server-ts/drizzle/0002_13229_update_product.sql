ALTER TABLE "products" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "quantity" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rating" integer;

-- These statements update products with IDs 1 through 27.
-- Each update uses values from a randomly selected product in the provided JavaScript file.
-- Assumes a table named 'products' with an 'id' column.

UPDATE products SET image = 'gold-phone-case.jpg', quantity = 0, category = 'Accessories', rating = 4 WHERE product_id = 1;
UPDATE products SET image = 'green-earbuds.jpg', quantity = 23, category = 'Electronics', rating = 4 WHERE product_id = 2;
UPDATE products SET image = 'yoga-mat.jpg', quantity = 15, category = 'Fitness', rating = 5 WHERE product_id = 3;
UPDATE products SET image = 'purple-band.jpg', quantity = 6, category = 'Fitness', rating = 3 WHERE product_id = 4;
UPDATE products SET image = 'bamboo-watch.jpg', quantity = 24, category = 'Accessories', rating = 5 WHERE product_id = 5;
UPDATE products SET image = 'teal-t-shirt.jpg', quantity = 3, category = 'Clothing', rating = 3 WHERE product_id = 6;
UPDATE products SET image = 'light-green-t-shirt.jpg', quantity = 34, category = 'Clothing', rating = 4 WHERE product_id = 7;
UPDATE products SET image = 'chakra-bracelet.jpg', quantity = 5, category = 'Accessories', rating = 3 WHERE product_id = 8;
UPDATE products SET image = 'yoga-set.jpg', quantity = 25, category = 'Fitness', rating = 8 WHERE product_id = 9;
UPDATE products SET image = 'green-t-shirt.jpg', quantity = 74, category = 'Clothing', rating = 5 WHERE product_id = 10;
UPDATE products SET image = 'yoga-mat.jpg', quantity = 15, category = 'Fitness', rating = 5 WHERE product_id = 11;
UPDATE products SET image = 'gold-phone-case.jpg', quantity = 0, category = 'Accessories', rating = 4 WHERE product_id = 12;
UPDATE products SET image = 'blue-band.jpg', quantity = 2, category = 'Fitness', rating = 3 WHERE product_id = 13;
UPDATE products SET image = 'green-t-shirt.jpg', quantity = 74, category = 'Clothing', rating = 5 WHERE product_id = 14;
UPDATE products SET image = 'painted-phone-case.jpg', quantity = 41, category = 'Accessories', rating = 5 WHERE product_id = 15;
UPDATE products SET image = 'green-earbuds.jpg', quantity = 23, category = 'Electronics', rating = 4 WHERE product_id = 16;
UPDATE products SET image = 'purple-t-shirt.jpg', quantity = 2, category = 'Clothing', rating = 5 WHERE product_id = 17;
UPDATE products SET image = 'blue-band.jpg', quantity = 2, category = 'Fitness', rating = 3 WHERE product_id = 18;
UPDATE products SET image = 'mini-speakers.jpg', quantity = 42, category = 'Clothing', rating = 4 WHERE product_id = 19;
UPDATE products SET image = 'yellow-earbuds.jpg', quantity = 35, category = 'Electronics', rating = 3 WHERE product_id = 20;
UPDATE products SET image = 'gold-phone-case.jpg', quantity = 0, category = 'Accessories', rating = 4 WHERE product_id = 21;
UPDATE products SET image = 'pink-purse.jpg', quantity = 0, category = 'Accessories', rating = 4 WHERE product_id = 22;
UPDATE products SET image = 'black-watch.jpg', quantity = 61, category = 'Accessories', rating = 4 WHERE product_id = 23;
UPDATE products SET image = 'teal-t-shirt.jpg', quantity = 3, category = 'Clothing', rating = 3 WHERE product_id = 24;
UPDATE products SET image = 'pink-purse.jpg', quantity = 0, category = 'Accessories', rating = 4 WHERE product_id = 25;
UPDATE products SET image = 'chakra-bracelet.jpg', quantity = 5, category = 'Accessories', rating = 3 WHERE product_id = 26;
UPDATE products SET image = 'yellow-earbuds.jpg', quantity = 35, category = 'Electronics', rating = 3 WHERE product_id = 27;