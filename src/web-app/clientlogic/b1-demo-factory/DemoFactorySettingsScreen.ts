/**
 * Client logic of the Settings screen: the runtime settings grid commits on its
 * own; this file keeps the demo users — the accounts recordings sign in as —
 * and re-asks the host what it can run after a setting changed.
 *
 * A demo user's API key never comes back to the browser: the form sends it
 * once to save-demo-user, which writes it to the secret store, and the field
 * is cleared straight after. The grid shows only whether a key is stored.
 */
import {
  displayConfirmationModal,
  displayError,
  displaySuccess,
  displayWarning,
  translate,
  type ObjectInstance
} from '@buildone/web-core';

import { DSO, callStudio, dsoOf, errorMessage, formOf } from '../shared/demoFactoryStudio';

const USER_FORM = 'DemoFactoryDemoUserForm';

interface DemoUserRow {
  id: string;
  label: string;
  appUrl: string;
  configured: boolean;
}

const fieldText = (form: ReturnType<typeof formOf>, name: string): string => String(form?.getValue(name) ?? '').trim();

/** A row picked in the grid lands in the form, ready to change — the key field stays empty. */
export function onDemoUserSelected(eventSource: ObjectInstance): void {
  const row = dsoOf<DemoUserRow>(eventSource.screen, DSO.demoUser)?.selectedRecord.value;
  const form = formOf(eventSource, USER_FORM);
  if (!row || !form) return;
  form.setSystemValue('id', row.id);
  form.setSystemValue('label', row.label);
  form.setSystemValue('appUrl', row.appUrl);
  form.setSystemValue('apiKey', '');
}

export function newDemoUser(eventSource: ObjectInstance): void {
  const form = formOf(eventSource, USER_FORM);
  for (const name of ['id', 'label', 'appUrl', 'apiKey']) form?.setSystemValue(name, '');
}

export async function saveDemoUser(eventSource: ObjectInstance): Promise<void> {
  const form = formOf(eventSource, USER_FORM);
  if (!form) return;
  const id = fieldText(form, 'id');
  if (!/^[\da-z][\da-z-]*$/.test(id)) {
    displayWarning(
      translate(
        'b1App.messages.DemoFactorySettingsScreen.invalidUserId',
        'A demo user id is lowercase letters, digits and hyphens, e.g. samples-demo.'
      )
    );
    return;
  }
  try {
    const { configured } = await callStudio<{ configured: boolean }>('save-demo-user', {
      id,
      label: fieldText(form, 'label'),
      appUrl: fieldText(form, 'appUrl'),
      apiKey: fieldText(form, 'apiKey')
    });
    form.setSystemValue('apiKey', '');
    await dsoOf(eventSource.screen, DSO.demoUser)?.fetchRecords();
    if (configured)
      displaySuccess(
        translate(
          'b1App.messages.DemoFactorySettingsScreen.userSaved',
          'Demo user {id} saved; its key is in the secret store.',
          { id }
        )
      );
    else
      displayWarning(
        translate(
          'b1App.messages.DemoFactorySettingsScreen.userSavedNoKey',
          'Demo user {id} saved, but no key is stored for it yet.',
          { id }
        )
      );
  } catch (error) {
    displayError(errorMessage(error), { life: 10_000 });
  }
}

export function deleteDemoUser(eventSource: ObjectInstance): void {
  const form = formOf(eventSource, USER_FORM);
  const id = fieldText(form, 'id');
  if (!id) {
    displayWarning(
      translate('b1App.messages.DemoFactorySettingsScreen.selectUserToDelete', 'Select the demo user to delete.')
    );
    return;
  }
  displayConfirmationModal({
    header: translate('b1App.messages.DemoFactorySettingsScreen.deleteHeader', 'Delete demo user'),
    message: translate(
      'b1App.messages.DemoFactorySettingsScreen.deleteMessage',
      'Delete demo user "{id}" and its API key in the secret store? Demos that sign in as it stop at their next recording until they name another one.',
      { id }
    ),
    icon: 'pi pi-exclamation-triangle',
    acceptProps: {
      label: translate('b1App.messages.DemoFactorySettingsScreen.deleteAccept', 'Delete'),
      severity: 'danger'
    },
    rejectProps: {
      label: translate('b1App.messages.DemoFactorySettingsScreen.deleteReject', 'Keep it'),
      outlined: true
    },
    accept: async () => {
      try {
        const { stillNamedBy } = await callStudio<{ stillNamedBy: string[] }>('delete-demo-user', { id });
        newDemoUser(eventSource);
        await dsoOf(eventSource.screen, DSO.demoUser)?.fetchRecords();
        displaySuccess(
          stillNamedBy.length
            ? translate(
                'b1App.messages.DemoFactorySettingsScreen.userDeletedStillNamed',
                'Deleted {id}. Still named by: {demos} — pick another demo user there.',
                { id, demos: stillNamedBy.join(', ') }
              )
            : translate('b1App.messages.DemoFactorySettingsScreen.userDeleted', 'Deleted {id}.', { id })
        );
      } catch (error) {
        displayError(errorMessage(error));
      }
    }
  });
}

/**
 * Several settings decide what this host can run — an API key, a browser path,
 * an ffmpeg path — so after the grid commits a value the stage verdicts and the
 * host capabilities are re-asked rather than left stale.
 */
export async function refreshVerdicts(eventSource: ObjectInstance): Promise<void> {
  const screen = eventSource.screen;
  await Promise.all([
    dsoOf(screen, DSO.setting)?.fetchRecords(),
    dsoOf(screen, DSO.stage)?.fetchRecords(),
    dsoOf(screen, DSO.host)?.fetchRecords()
  ]);
}
