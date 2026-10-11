import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/guard";
import { can } from "@/lib/rbac";
import NotificationsClient from "./NotificationsClient";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requirePage();
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  void can;

  return (
    <NotificationsClient
      notifications={notifications.map((n) => ({
        id: n.id, title: n.title, body: n.body, link: n.link, severity: n.severity,
        read: n.read, createdAt: n.createdAt.toISOString(),
      }))}
    />
  );
}
