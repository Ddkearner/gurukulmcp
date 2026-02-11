require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD || process.env.DB_PASS,
        database: process.env.DB_NAME,
    });

    console.log('--- Fee Status Verification ---');

    try {
        const studentId = 1;

        // 1. Initial Status
        console.log('\nChecking initial status...');
        const [initialRows] = await pool.execute(`
            SELECT 
                SUM(gd.amount + fa.prev_due) as total_allocated,
                (SELECT SUM(amount + discount) FROM fee_payment_history h JOIN fee_allocation a ON h.allocation_id = a.id WHERE a.student_id = fa.student_id AND a.session_id = 4) as total_paid
            FROM fee_allocation fa
            LEFT JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
            WHERE fa.student_id = ? AND fa.session_id = 4
        `, [studentId]);
        let data = initialRows[0];
        console.log(`Allocated: ${data.total_allocated}, Paid: ${data.total_paid}, Balance: ${data.total_allocated - data.total_paid}`);

        // 2. Set to Paid (simulating tool set_fee_status)
        console.log('\nSetting status to "Paid"...');
        const [allocs] = await pool.execute(`
            SELECT fa.id as allocation_id, gd.fee_type_id, (gd.amount + fa.prev_due) as total_due
            FROM fee_allocation fa
            JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
            WHERE fa.student_id = ? AND fa.session_id = 4
        `, [studentId]);

        for (const row of allocs) {
            const [history] = await pool.execute(`
                SELECT SUM(amount + discount) as paid 
                FROM fee_payment_history 
                WHERE allocation_id = ? AND type_id = ?
            `, [row.allocation_id, row.fee_type_id]);
            const paid = history[0].paid || 0;
            const remaining = row.total_due - paid;
            if (remaining > 0) {
                await pool.execute(
                    "INSERT INTO fee_payment_history (allocation_id, type_id, collect_by, amount, date) VALUES (?, ?, 'admin_verified', ?, NOW())",
                    [row.allocation_id, row.fee_type_id, remaining]
                );
            }
        }

        // 3. Verify Paid Status
        const [paidRows] = await pool.execute(`
            SELECT 
                SUM(gd.amount + fa.prev_due) as total_allocated,
                (SELECT SUM(amount + discount) FROM fee_payment_history h JOIN fee_allocation a ON h.allocation_id = a.id WHERE a.student_id = fa.student_id AND a.session_id = 4) as total_paid
            FROM fee_allocation fa
            LEFT JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
            WHERE fa.student_id = ? AND fa.session_id = 4
        `, [studentId]);
        data = paidRows[0];
        console.log(`Allocated: ${data.total_allocated}, Paid: ${data.total_paid}, Balance: ${data.total_allocated - data.total_paid}`);

        // 4. Set to Unpaid (simulating tool set_fee_status)
        console.log('\nSetting status to "Unpaid"...');
        await pool.execute(`
            DELETE h FROM fee_payment_history h
            JOIN fee_allocation fa ON h.allocation_id = fa.id
            WHERE fa.student_id = ? AND fa.session_id = 4
        `, [studentId]);

        // 5. Verify Unpaid Status
        const [unpaidRows] = await pool.execute(`
            SELECT 
                SUM(gd.amount + fa.prev_due) as total_allocated,
                (SELECT SUM(amount + discount) FROM fee_payment_history h JOIN fee_allocation a ON h.allocation_id = a.id WHERE a.student_id = fa.student_id AND a.session_id = 4) as total_paid
            FROM fee_allocation fa
            LEFT JOIN fee_groups_details gd ON fa.group_id = gd.fee_groups_id
            WHERE fa.student_id = ? AND fa.session_id = 4
        `, [studentId]);
        data = unpaidRows[0];
        console.log(`Allocated: ${data.total_allocated}, Paid: ${data.total_paid || 0}, Balance: ${data.total_allocated - (data.total_paid || 0)}`);

    } catch (error) {
        console.error('Verification failed:', error);
    } finally {
        await pool.end();
    }
}

main();
