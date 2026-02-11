const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

async function testHR() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || '',
        database: process.env.DB_NAME || 'ramom'
    });
    
    console.log('Testing HR System...\n');
    
    // Test 1: Leave Categories
    const [cats] = await conn.execute('SELECT * FROM leave_category WHERE branch_id = 1');
    console.log(Leave Categories: );
    
    // Test 2: Staff Attendance
    const [att] = await conn.execute('SELECT * FROM staff_attendance LIMIT 5');
    console.log(Staff Attendance Records: );
    
    // Test 3: Staff Leaves
    const [leaves] = await conn.execute('SELECT * FROM leave_application WHERE role_id = 2 LIMIT 5');
    console.log(Staff Leave Applications: );
    
    // Test 4: Student Leaves
    const [stuLeaves] = await conn.execute('SELECT * FROM leave_application WHERE role_id = 7 LIMIT 5');
    console.log(Student Leave Applications: );
    
    console.log('\n All HR database tables accessible!');
    
    await conn.end();
}

testHR().catch(console.error);
