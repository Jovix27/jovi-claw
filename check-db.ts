import { createClient } from "@libsql/client";
import fs from "fs";

const db = createClient({ url: "file:jovi_memory.db" });

async function check() {
    try {
        const rs = await db.execute("SELECT role, content FROM conversation_buffer ORDER BY id DESC LIMIT 10");
        fs.writeFileSync("clean_dump.json", JSON.stringify(rs.rows, null, 2), "utf-8");
    } catch (err) {
        console.error(err);
    }
}
check();
