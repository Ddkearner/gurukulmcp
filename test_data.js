require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || process.env.DB_PASS,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    });

    console.log('Connecting to database...');

    try {
        // Clear old test data (optional, but keep it for idempotency in this demo script)
        // Note: In a real environment, you might not want to delete.

        console.log('Inserting demo data...');

        // 1. Staff
        await pool.execute(
            "INSERT IGNORE INTO staff (id, name, sex, designation, department, joining_date, mobileno, email, branch_id, staff_id) VALUES (1, 'Admin User', 'Male', 1, 1, NOW(), '1234567890', 'admin@example.com', 1, 'ST1001')"
        );

        // 2. Class & Section (Need these for students)
        await pool.execute("INSERT IGNORE INTO class (id, name, branch_id) VALUES (1, 'Class 1', 1)");
        await pool.execute("INSERT IGNORE INTO section (id, name, capacity, branch_id) VALUES (1, 'Section A', 30, 1)");

        // 3. Students
        await pool.execute(
            "INSERT IGNORE INTO student (id, first_name, last_name, register_no, admission_date, gender, birthday, mobileno, email, parent_id) VALUES (1, 'John', 'Doe', 'REG001', '2025-01-01', 'Male', '2015-05-15', '9876543210', 'john@example.com', 1)"
        );
        await pool.execute(
            "INSERT IGNORE INTO enroll (id, student_id, class_id, section_id, roll, branch_id, session_id) VALUES (1, 1, 1, 1, 1, 1, 4)"
        );

        // 4. Inquiries
        await pool.execute(
            "INSERT IGNORE INTO enquiry (id, name, mobile_no, date, father_name, mother_name, email, address, note, response, class_id, branch_id, status, created_by) VALUES (1, 'Jane Smith', '1122334455', '2026-02-01', 'Robert Smith', 'Linda Smith', 'jane@example.com', '123 Maple St', 'Interested in Class 1', 'Provided brochure', 1, 1, 1, 1)"
        );

        // 5. Product Category & Unit for Inventory
        await pool.execute("INSERT IGNORE INTO product_category (id, name, branch_id) VALUES (1, 'Stationery', 1)");
        await pool.execute("INSERT IGNORE INTO product_unit (id, name, branch_id) VALUES (1, 'Piece', 1)");
        await pool.execute("INSERT IGNORE INTO product_store (id, name, code, branch_id) VALUES (1, 'Main Store', 'STORE01', 1)");
        await pool.execute("INSERT IGNORE INTO product_supplier (id, name, mobileno, branch_id) VALUES (1, 'Global Supplies', '555-0100', 1)");

        // 6. Products
        await pool.execute(
            "INSERT IGNORE INTO product (id, name, code, category_id, purchase_unit_id, sales_unit_id, purchase_price, sales_price, available_stock, branch_id) VALUES (1, 'Pencil', 'PEN001', 1, 1, 1, 2.00, 5.00, '100', 1)"
        );

        // 7. Fee Management Data
        console.log('Inserting fee demo data...');
        // Fee Types
        await pool.execute("INSERT IGNORE INTO fees_type (id, name, fee_code, branch_id, system) VALUES (1, 'Tuition Fee', 'tuition-fee', 1, 0)");
        await pool.execute("INSERT IGNORE INTO fees_type (id, name, fee_code, branch_id, system) VALUES (2, 'Library Fee', 'library-fee', 1, 0)");

        // Fee Groups
        await pool.execute("INSERT IGNORE INTO fee_groups (id, name, branch_id, session_id, system) VALUES (1, 'Class 1 Fees', 1, 4, 0)");

        // Fee Groups Details (linking types to groups)
        await pool.execute("INSERT IGNORE INTO fee_groups_details (id, fee_groups_id, fee_type_id, amount, due_date) VALUES (1, 1, 1, 5000, '2026-06-01')");
        await pool.execute("INSERT IGNORE INTO fee_groups_details (id, fee_groups_id, fee_type_id, amount, due_date) VALUES (2, 1, 2, 200, '2026-06-01')");

        // Fee Allocation (Student 1)
        await pool.execute("INSERT IGNORE INTO fee_allocation (id, student_id, group_id, branch_id, session_id, prev_due) VALUES (1, 1, 1, 1, 4, 0)");

        // Initial Payment (Partial)
        await pool.execute(
            "INSERT IGNORE INTO fee_payment_history (id, allocation_id, type_id, collect_by, amount, discount, fine, date) VALUES (1, 1, 1, 'admin', 2000, 0, 0, '2026-02-05')"
        );

        // Payment Methods
        await pool.execute("INSERT IGNORE INTO payment_types (id, name, branch_id) VALUES (1, 'Cash', 1)");
        await pool.execute("INSERT IGNORE INTO payment_types (id, name, branch_id) VALUES (2, 'Bank Transfer', 1)");
        await pool.execute("INSERT IGNORE INTO payment_types (id, name, branch_id) VALUES (3, 'Cheque', 1)");

        // Accounts
        await pool.execute("INSERT IGNORE INTO accounts (id, name, number, balance, branch_id) VALUES (1, 'Main School Account', '123456789', 50000, 1)");

        console.log('Fee demo data inserted successfully!');

        console.log('Demo data inserted successfully!');
    } catch (error) {
        console.error('Error inserting demo data:', error);
    } finally {
        await pool.end();
    }
}

main();
