import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function EditCampaignPage({
    params,
}: {
    params: { id: string };
}) {
    const supabase = createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) return notFound();

    const { data: campaign } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", params.id)
        .eq("creator_id", user.id)
        .single();

    if (!campaign) return notFound();

    return (
        <div className="p-6 space-y-4">
            <h1 className="text-2xl font-bold">Edit Campaign</h1>

            <div className="rounded-xl border p-4">
                <p><b>Name:</b> {campaign.name}</p>
                <p><b>Slug:</b> {campaign.slug}</p>
                <p><b>Status:</b> {campaign.status}</p>
                <p><b>Total Views:</b> {campaign.total_views}</p>
                <p><b>Valid Views:</b> {campaign.valid_views}</p>
                <p><b>Invalid Views:</b> {campaign.invalid_views}</p>
                <p><b>Total Earnings:</b> ${campaign.total_earnings}</p>
            </div>
        </div>
    );
}