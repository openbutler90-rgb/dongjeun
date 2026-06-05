import { addDoc, collection, serverTimestamp, query, where, getDocs, doc } from 'firebase/firestore';
import { db } from './firebase';
import { sendOneSignalNotification } from './onesignal';

export type NotificationType =
  | 'new_notice'
  | 'new_meeting'
  | 'like_on_post'
  | 'comment_on_post'
  | 'chat_reply'
  | 'guest_approved'
  | 'new_guest_request'
  | 'new_user_joined'
  | 'report_received';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  postId?: string;
  postTitle?: string;
  actorId?: string;
  actorName?: string;
  channelId?: string;
  url?: string;
}

/** ✅ Firestore에 알림 저장 (앱 내 알림) */
export async function saveInAppNotification(params: CreateNotificationParams) {
  try {
    await addDoc(collection(db, 'notifications'), {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      postId: params.postId || '',
      actorId: params.actorId || '',
      actorName: params.actorName || '',
      channelId: params.channelId || '',
      url: params.url || '',
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[Notification] Failed to save:', err);
  }
}

/** ✅ 개인 알림: Firestore 저장 + OneSignal 개별 푸시 */
export async function sendPersonalNotification(params: CreateNotificationParams) {
  await saveInAppNotification(params);
  await sendOneSignalNotification({
    title: params.title,
    body: params.message,
    url: params.url,
    externalUserIds: [params.userId],
  });
}

/** ✅ 전역 알림: Firestore 저장(userId='all') + OneSignal 푸시 */
export async function sendGlobalNotification(params: CreateNotificationParams) {
  await saveInAppNotification({ ...params, userId: 'all' });
  await sendOneSignalNotification({
    title: params.title,
    body: params.message,
    url: params.url,
    targetSegments: ['All'],
  });
}

/** ✅ 운영자 알림: admin/manager에게만 */
export async function notifyAdmins(params: Omit<CreateNotificationParams, 'userId'>) {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('role', 'in', ['admin', 'manager']));
    const snap = await getDocs(q);
    const adminIds = snap.docs.map(d => d.id);

    // 각 운영자에게 개별 알림 저장 + 푸시
    await Promise.all(
      adminIds.map(adminId =>
        sendPersonalNotification({ ...params, userId: adminId })
      )
    );
  } catch (err) {
    console.error('[Notification] Admin notify failed:', err);
  }
}

/** ✅ 특정 사용자에게 알림 */
export async function notifyUser(params: Omit<CreateNotificationParams, 'userId'>, targetUserId: string) {
  await sendPersonalNotification({ ...params, userId: targetUserId });
}
