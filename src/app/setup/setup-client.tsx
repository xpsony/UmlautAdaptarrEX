"use client";

import { AdminStep } from "./_components/admin-step";
import { ModeStep } from "./_components/mode-step";
import { PluginsStep } from "./_components/plugins-step";
import { ProwlarrConnectStep } from "./_components/prowlarr-connect-step";
import { ProwlarrImportStep } from "./_components/prowlarr-import-step";
import { ProwlarrInstallStep } from "./_components/prowlarr-install-step";
import { ProwlarrPatchIndexersStep } from "./_components/prowlarr-patch-indexers-step";
import { ProxyStep } from "./_components/proxy-step";
import { Stepper } from "./_components/stepper";
import { SyncStep } from "./_components/sync-step";
import type { SetupStatus } from "./_lib/setup-wizard";
import { useSetupWizard } from "./_lib/use-setup-wizard";

export function SetupClient({ initialStatus }: { initialStatus: SetupStatus }) {
  const w = useSetupWizard(initialStatus);

  return (
    <>
      <Stepper steps={w.steps} currentIndex={w.currentStepIndex} />

      <div className="mt-6 space-y-6">
        {w.step === "admin" ? (
          <AdminStep
            form={w.adminForm}
            tmdbTesting={w.tmdbTesting}
            tmdbTestResult={w.tmdbTestResult}
            tvdbTesting={w.tvdbTesting}
            tvdbTestResult={w.tvdbTestResult}
            onSubmit={w.onAdminSubmit}
            onTmdbTest={w.onTmdbTest}
            onTvdbTest={w.onTvdbTest}
          />
        ) : null}

        {w.step === "mode" ? (
          <ModeStep
            value={w.operationMode}
            onChange={w.setOperationMode}
            onBack={() => w.setStep("admin")}
            onNext={() => {
              w.setStep("plugins");
              void w.loadPluginList();
            }}
          />
        ) : null}

        {w.step === "plugins" ? (
          <PluginsStep
            pluginList={w.pluginList}
            pluginEnabled={w.pluginEnabled}
            tmdbKey={w.adminForm.getValues("tmdbApiKey") ?? ""}
            onTogglePlugin={w.togglePlugin}
            onBack={() => w.setStep("mode")}
            onNext={() => w.setStep("prowlarr-connect")}
          />
        ) : null}

        {w.step === "prowlarr-connect" ? (
          <ProwlarrConnectStep
            form={w.prowlarrForm}
            hostValue={w.prowlarrHostValue}
            testResult={w.prowlarrTestResult}
            testing={w.prowlarrTesting}
            previewLoading={w.previewLoading}
            onSubmit={w.onProwlarrSubmit}
            onBack={() => w.setStep("plugins")}
            onSkip={w.skipProwlarr}
            onTest={w.onProwlarrTest}
          />
        ) : null}

        {w.step === "prowlarr-import" ? (
          <ProwlarrImportStep
            apps={w.prowlarrApps}
            skippedApps={w.prowlarrSkippedApps}
            selectedAppIds={w.selectedAppIds}
            appRows={w.appRows}
            operationMode={w.operationMode}
            isSubmitting={w.isSubmitting}
            onToggleApp={w.toggleApp}
            onUpdateAppRow={w.updateAppRow}
            onTestAppRow={w.testAppRow}
            onBack={() => w.setStep("prowlarr-connect")}
            onNext={w.advanceFromProwlarrImport}
          />
        ) : null}

        {w.step === "proxy" ? (
          <ProxyStep
            form={w.proxyForm}
            prowlarrConnected={w.prowlarrConnected}
            isSubmitting={w.isSubmitting}
            onSubmit={w.onProxySubmit}
            onBack={() => w.setStep(w.prowlarrConnected ? "prowlarr-import" : "prowlarr-connect")}
            onRegeneratePassword={w.regenerateProxyPassword}
          />
        ) : null}

        {w.step === "prowlarr-install" ? (
          <ProwlarrInstallStep
            installPreview={w.installPreview}
            proxyValues={w.proxyValues}
            installHost={w.installHost}
            isSubmitting={w.isSubmitting}
            onHostChange={w.setInstallHost}
            onBack={() => w.setStep("proxy")}
            onSkip={w.skipInstallProxy}
            onSubmit={w.submitInstallProxy}
          />
        ) : null}

        {w.step === "prowlarr-patch-indexers" ? (
          <ProwlarrPatchIndexersStep
            indexers={w.patchIndexers}
            selectedIds={w.patchSelectedIds}
            loading={w.patchLoading}
            submitting={w.patchSubmitting}
            onToggle={w.togglePatchIndexer}
            onToggleAll={w.togglePatchAll}
            onSkip={w.skipPatchIndexers}
            onSubmit={w.submitPatchIndexers}
          />
        ) : null}

        {w.step === "sync" ? (
          <SyncStep
            instanceCount={w.importedInstancesCount}
            submitting={w.syncSubmitting}
            onStart={w.startSyncAndFinish}
            onSkip={w.skipSyncAndFinish}
          />
        ) : null}
      </div>
    </>
  );
}
