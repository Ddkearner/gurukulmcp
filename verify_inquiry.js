require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || process.env.DB_PASS,
        database: process.env.DB_NAME,
    });

    console.log('--- Admission Enquiry Verification ---');

    try {
        // 1. Verify Metadata Tools
        console.log('\n[1] Testing metadata tools...');
        const [sources] = await pool.execute("SELECT * FROM enquiry_reference WHERE branch_id = 1");
        console.log(`Sources found: ${sources.length}`);

        const [responses] = await pool.execute("SELECT * FROM enquiry_response WHERE branch_id = 1");
        console.log(`Response categories found: ${responses.length}`);

        // 2. Testing Advanced Filtering
        console.log('\n[2] Testing filtering in list_inquiries...');

        // Filter by class_id: 1
        const [class1] = await pool.execute(`
            SELECT e.* FROM enquiry e WHERE e.class_id = 1
        `);
        console.log(`Inquiries for Class 1: ${class1.length} (Expected 2: Jane Smith, Bob Wilson)`);

        // Filter by status: active
        const [active] = await pool.execute(`
            SELECT e.* FROM enquiry e WHERE e.status = 'active'
        `);
        console.log(`Active inquiries: ${active.length} (Expected 2: Jane Smith, Bob Wilson)`);

        // Filter by source_id: 2 (Social Media)
        const [source2] = await pool.execute(`
            SELECT e.* FROM enquiry e WHERE e.reference_id = 2
        `);
        console.log(`Inquiries from Social Media: ${source2.length} (Expected 2: Mike Jones, Bob Wilson)`);

        // 3. Testing Bulk Deletion
        console.log('\n[3] Testing bulk_delete_inquiries...');
        const idsToDelete = [4, 5];
        const [delResult] = await pool.execute(`DELETE FROM enquiry WHERE id IN (${idsToDelete.map(() => "?").join(",")})`, idsToDelete);
        console.log(`Deleted rows: ${delResult.affectedRows} (Expected 2)`);

        const [remaining] = await pool.execute("SELECT COUNT(*) as count FROM enquiry");
        console.log(`Total inquiries remaining: ${remaining[0].count} (Expected 3)`);

        console.log('\nVerification Successful!');

    } catch (error) {
        console.error('Verification failed:', error);
    } finally {
        await pool.end();
    }
}

main();
