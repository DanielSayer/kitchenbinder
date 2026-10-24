import { createFileRoute } from "@tanstack/react-router";
import { AccountControls } from "@/components/account-controls";
import { SettingsPage } from "@/components/settings-page";

export const Route = createFileRoute("/_auth/settings_/delete-account")({
  ssr: false,
  component: DeleteAccount,
});

function DeleteAccount() {
  return (
    <SettingsPage title="Delete account" className="delete-account-page">
      <AccountControls />
    </SettingsPage>
  );
}
