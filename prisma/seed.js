// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const users = [
    { username: "zyx", password: "zyx070201" },
    { username: "lxf", password: "lxf060321" },
    { username: "pjh", password: "pjh060614" },
    { username: "yyh", password: "yyh051118" }
  ];

  console.log("Seeding users...");

  for (const u of users) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      const user = await prisma.user.upsert({
          where: { username: u.username },
          update: { password: hashedPassword },
          create: {
              username: u.username,
              password: hashedPassword,
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username}`
          }
      });
      console.log(`Created/Updated user: ${u.username}`);
  }

  // 可选：清理其他用户，确保只保留这四个 (根据需求 "改为四个用户")
  // await prisma.user.deleteMany({ where: { username: { notIn: users.map(u => u.username) } } });

  console.log("✅ Database seeded successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
