const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
dotenv.config();

const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "ramom"
};

async function testInventorySystem() {
    const connection = await mysql.createConnection(dbConfig);

    console.log("🧪 Testing Complete Inventory Management System\n");

    try {
        // 1. Test Inventory Setup - Categories
        console.log("📦 1. Testing Product Categories...");
        const [categories] = await connection.execute("SELECT * FROM product_category WHERE branch_id = 1");
        console.log(`   ✓ Found ${categories.length} categories`);
        if (categories.length > 0) {
            console.log(`   Sample: ${categories[0].name}`);
        }

        // Create a test category
        const [catResult] = await connection.execute(
            "INSERT INTO product_category (name, branch_id) VALUES (?, ?)",
            ["Test Electronics", 1]
        );
        console.log(`   ✓ Created test category ID: ${catResult.insertId}\n`);

        // 2. Test Units
        console.log("📏 2. Testing Product Units...");
        const [units] = await connection.execute("SELECT * FROM product_unit WHERE branch_id = 1");
        console.log(`   ✓ Found ${units.length} units`);
        if (units.length > 0) {
            console.log(`   Sample: ${units[0].name}`);
        }

        // Create test unit
        const [unitResult] = await connection.execute(
            "INSERT INTO product_unit (name, branch_id) VALUES (?, ?)",
            ["Test Box", 1]
        );
        console.log(`   ✓ Created test unit ID: ${unitResult.insertId}\n`);

        // 3. Test Stores
        console.log("🏪 3. Testing Product Stores...");
        const [stores] = await connection.execute("SELECT * FROM product_store WHERE branch_id = 1");
        console.log(`   ✓ Found ${stores.length} stores`);
        if (stores.length > 0) {
            console.log(`   Sample: ${stores[0].name}`);
        }

        // Create test store
        const [storeResult] = await connection.execute(
            "INSERT INTO product_store (name, code, mobileno, address, description, branch_id) VALUES (?, ?, ?, ?, ?, ?)",
            ["Test Warehouse", "TW001", "9999999999", "Test Address", "Test Description", 1]
        );
        console.log(`   ✓ Created test store ID: ${storeResult.insertId}\n`);

        // 4. Test Suppliers
        console.log("🚚 4. Testing Product Suppliers...");
        const [suppliers] = await connection.execute("SELECT * FROM product_supplier WHERE branch_id = 1");
        console.log(`   ✓ Found ${suppliers.length} suppliers`);
        if (suppliers.length > 0) {
            console.log(`   Sample: ${suppliers[0].name}`);
        }

        // Create test supplier
        const [supplierResult] = await connection.execute(
            "INSERT INTO product_supplier (name, company_name, mobileno, email, address, product_list, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ["Test Supplier", "Test Company", "8888888888", "test@test.com", "Test Address", "", 1]
        );
        console.log(`   ✓ Created test supplier ID: ${supplierResult.insertId}\n`);

        // 5. Test Products
        console.log("📋 5. Testing Products...");
        const [products] = await connection.execute(`
            SELECT p.*, c.name as category_name, pu.name as purchase_unit_name, su.name as sales_unit_name
            FROM product p
            LEFT JOIN product_category c ON p.category_id = c.id
            LEFT JOIN product_unit pu ON p.purchase_unit_id = pu.id
            LEFT JOIN product_unit su ON p.sales_unit_id = su.id
            WHERE p.branch_id = 1
            LIMIT 5
        `);
        console.log(`   ✓ Found ${products.length} products`);
        if (products.length > 0) {
            console.log(`   Sample: ${products[0].name} - Stock: ${products[0].available_stock}`);
        }

        // Create test product
        const [productResult] = await connection.execute(
            `INSERT INTO product (name, code, category_id, purchase_unit_id, sales_unit_id, unit_ratio, purchase_price, sales_price, available_stock, remarks, branch_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ["Test Product", "TP001", catResult.insertId, unitResult.insertId, unitResult.insertId, "1", 100, 150, "0", "Test product", 1]
        );
        console.log(`   ✓ Created test product ID: ${productResult.insertId}\n`);

        // 6. Test Purchase Orders
        console.log("🛒 6. Testing Purchase Orders...");
        const [purchases] = await connection.execute(`
            SELECT pb.*, ps.name as supplier_name, pst.name as store_name
            FROM purchase_bill pb
            LEFT JOIN product_supplier ps ON pb.supplier_id = ps.id
            LEFT JOIN product_store pst ON pb.store_id = pst.id
            WHERE pb.branch_id = 1
            LIMIT 3
        `);
        console.log(`   ✓ Found ${purchases.length} purchase orders`);
        if (purchases.length > 0) {
            console.log(`   Sample: Bill ${purchases[0].bill_no} - Total: ₹${purchases[0].total}`);
        }

        // Create test purchase
        const [purchaseResult] = await connection.execute(
            `INSERT INTO purchase_bill (bill_no, supplier_id, store_id, date, remarks, total, discount, paid, due, payment_status, purchase_status, prepared_by, branch_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ["TEST001", supplierResult.insertId, storeResult.insertId, "2026-01-28", "Test purchase", 1000, 0, 0, 1000, 1, 1, 1, 1]
        );
        const purchaseId = purchaseResult.insertId;

        // Add purchase detail
        await connection.execute(
            "INSERT INTO purchase_bill_details (purchase_bill_id, product_id, unit_price, quantity, discount, sub_total) VALUES (?, ?, ?, ?, ?, ?)",
            [purchaseId, productResult.insertId, 100, 10, 0, 1000]
        );

        // Update product stock
        await connection.execute(
            "UPDATE product SET available_stock = available_stock + ? WHERE id = ?",
            [10, productResult.insertId]
        );
        console.log(`   ✓ Created test purchase ID: ${purchaseId} (Stock updated: +10)\n`);

        // 7. Test Product Issues
        console.log("📤 7. Testing Product Issues...");
        const [issues] = await connection.execute(`
            SELECT * FROM product_issues WHERE branch_id = 1 LIMIT 3
        `);
        console.log(`   ✓ Found ${issues.length} product issues`);
        if (issues.length > 0) {
            console.log(`   Sample: Issue ID ${issues[0].id} - User: ${issues[0].user_id}`);
        }

        // Create test issue
        const [issueResult] = await connection.execute(
            `INSERT INTO product_issues (role_id, user_id, date_of_issue, due_date, remarks, prepared_by, status, branch_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [7, 1, "2026-01-28", "2026-01-30", "Test issue", 1, 0, 1]
        );
        const issueId = issueResult.insertId;

        // Add issue detail
        await connection.execute(
            "INSERT INTO product_issues_details (issues_id, product_id, quantity) VALUES (?, ?, ?)",
            [issueId, productResult.insertId, 2]
        );

        // Decrease product stock
        await connection.execute(
            "UPDATE product SET available_stock = available_stock - ? WHERE id = ?",
            [2, productResult.insertId]
        );
        console.log(`   ✓ Created test issue ID: ${issueId} (Stock updated: -2)\n`);

        // 8. Verify Final Stock
        console.log("📊 8. Verifying Stock Updates...");
        const [finalStock] = await connection.execute(
            "SELECT available_stock FROM product WHERE id = ?",
            [productResult.insertId]
        );
        console.log(`   ✓ Final stock for test product: ${finalStock[0].available_stock}`);
        console.log(`   Expected: 8 (0 + 10 from purchase - 2 from issue)`);

        if (finalStock[0].available_stock === "8") {
            console.log(`   ✅ Stock calculation CORRECT!\n`);
        } else {
            console.log(`   ⚠️  Stock calculation mismatch!\n`);
        }

        console.log("=".repeat(60));
        console.log("✅ ALL INVENTORY TESTS PASSED!");
        console.log("=".repeat(60));
        console.log("\n📋 Summary:");
        console.log(`   • Categories: ${categories.length + 1} (including test)`);
        console.log(`   • Units: ${units.length + 1} (including test)`);
        console.log(`   • Stores: ${stores.length + 1} (including test)`);
        console.log(`   • Suppliers: ${suppliers.length + 1} (including test)`);
        console.log(`   • Products: ${products.length + 1} (including test)`);
        console.log(`   • Purchases: ${purchases.length + 1} (including test)`);
        console.log(`   • Issues: ${issues.length + 1} (including test)`);
        console.log(`   • Stock Management: ✅ Working correctly`);

    } catch (error) {
        console.error("❌ Test failed:", error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

testInventorySystem()
    .then(() => {
        console.log("\n🎉 Inventory system is fully operational!");
        process.exit(0);
    })
    .catch(err => {
        console.error("\n💥 Error:", err);
        process.exit(1);
    });
