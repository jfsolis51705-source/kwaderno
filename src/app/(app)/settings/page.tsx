import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireAppContext } from "@/server/auth/current";
import { getStore, hasRole, listMembers } from "@/server/services/stores";
import { StoreProfileForm } from "./store-profile-form";
import { MembersCard } from "./members-card";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { store, user } = await requireAppContext();
  const [profile, members] = await Promise.all([getStore(store), listMembers(store)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Store profile and who can access this store." />
      <StoreProfileForm
        storeId={store.storeId}
        canEdit={hasRole(store, "manager")}
        isOwner={hasRole(store, "owner")}
        initial={{
          name: profile.name,
          ownerName: profile.ownerName ?? "",
          phone: profile.phone ?? "",
          addressLine: profile.addressLine ?? "",
          barangay: profile.barangay ?? "",
          city: profile.city ?? "",
          province: profile.province ?? "",
          allowNegativeStock: profile.allowNegativeStock,
          location: profile.latitude != null && profile.longitude != null ? { latitude: Number(profile.latitude), longitude: Number(profile.longitude) } : null,
          pilotStoreName: profile.pilotStoreName,
        }}
      />
      <MembersCard
        storeId={store.storeId}
        isOwner={hasRole(store, "owner")}
        currentUserId={user.id}
        members={members.map((m) => ({ id: m.id, userId: m.userId, fullName: m.fullName, email: m.email, role: m.role }))}
      />
    </div>
  );
}
