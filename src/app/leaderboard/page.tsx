import { redirect } from "next/navigation";

export default function LeaderboardDisabledPage() {
  redirect("/transfer-grades?gender=men&season=2026");
}
