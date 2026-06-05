declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: any) => void>;
    OneSignal?: any;
  }
}

const APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID || '';

function getOneSignal(): Promise<any> {
  return new Promise((resolve) => {
    if (window.OneSignal) {
      resolve(window.OneSignal);
      return;
    }
    const check = setInterval(() => {
      if (window.OneSignal) {
        clearInterval(check);
        resolve(window.OneSignal);
      }
    }, 200);
    setTimeout(() => clearInterval(check), 10000);
  });
}

export async function loginOneSignal(userId: string, email?: string) {
  if (!APP_ID) return;
  try {
    const os = await getOneSignal();
    // ✅ SDK 완전 초기화 + 구독 상태 확인 후에만 login
    if (!os.User || !os.Notifications) {
      console.log('[OneSignal] SDK not fully initialized, skipping login');
      return;
    }
    const permission = await os.Notifications.permission;
    if (!permission) {
      console.log('[OneSignal] Not subscribed yet, skipping login');
      return;
    }
    await os.login(userId);
    if (email) {
      await os.User.addEmail(email);
    }
    console.log('[OneSignal] Login:', userId);
  } catch (err) {
    console.warn('[OneSignal] Login failed:', err);
  }
}

export async function logoutOneSignal() {
  if (!APP_ID) return;
  try {
    const os = await getOneSignal();
    const permission = await os.Notifications.permission;
    if (!permission) {
      console.log('[OneSignal] Not subscribed, skipping logout');
      return;
    }
    await os.logout();
    console.log('[OneSignal] Logout');
  } catch (err) {
    console.warn('[OneSignal] Logout failed:', err);
  }
}

export async function requestOneSignalPermission(): Promise<boolean> {
  if (!APP_ID) return false;
  try {
    const os = await getOneSignal();
    const permission = await os.notifications.permission;
    if (permission) return true;
    await os.notifications.requestPermission();
    return await os.notifications.permission;
  } catch (err) {
    console.warn('[OneSignal] Permission request failed:', err);
    return false;
  }
}

export async function isOneSignalSubscribed(): Promise<boolean> {
  if (!APP_ID) return false;
  try {
    const os = await getOneSignal();
    return await os.notifications.permission;
  } catch {
    return false;
  }
}

// ✅ 관리자용: OneSignal REST API로 알림 발송
export async function sendOneSignalNotification({
  title,
  body,
  url,
  targetSegments = ['All'],
  externalUserIds,
}: {
  title: string;
  body: string;
  url?: string;
  targetSegments?: string[];
  externalUserIds?: string[];
}): Promise<boolean> {
  const apiKey = import.meta.env.VITE_ONESIGNAL_REST_API_KEY;
  if (!apiKey) {
    console.error('[OneSignal] REST API Key 누락');
    return false;
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: APP_ID,
        headings: { en: title },
        contents: { en: body },
        ...(externalUserIds && externalUserIds.length > 0
          ? { include_external_user_ids: externalUserIds }
          : { included_segments: targetSegments }
        ),
        ...(url ? { url } : {}),
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const err = await response.text();
      console.error(`[OneSignal] Send failed (HTTP ${status}):`, err);
      return false;
    }

    const result = await response.json();
    console.log('[OneSignal] Sent:', result);
    if (result.recipients !== undefined) {
      console.log(`[OneSignal] Recipients: ${result.recipients} (구독자 수)`);
    }
    if (result.errors) {
      console.error('[OneSignal] Errors:', result.errors);
    }
    return true;
  } catch (err) {
    console.error('[OneSignal] Send error:', err);
    return false;
  }
}
