import { redirect } from "next/navigation";

export default function LeaderboardDisabledPage() {
  redirect("/cards?gender=men");
}

