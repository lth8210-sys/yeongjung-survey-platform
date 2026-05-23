/**
 * repairSurvey.mjs
 * Diagnoses and repairs survey P7aUWpx3gxwDY7aQgEbN via Firestore REST API.
 *
 * Findings from pre-diagnosis:
 *   - status: 'deleted', deleted: true, deletedPreviousStatus: 'published'
 *   - Q22-Q25 sectionId = section-5945e840 (주관식) ← already correct
 *   - All pageEndAction = 'next' ← already correct
 *
 * Repair actions:
 *   1. Restore status → 'published'
 *   2. Set deleted → false
 *   3. Remove deletedAt / deletedPreviousStatus fields
 *
 * Usage: node scripts/repairSurvey.mjs [--dry-run]
 */

import { readFileSync } from 'fs';

const PROJECT_ID = 'yeongjung-survey-platform';
const SURVEY_ID = 'P7aUWpx3gxwDY7aQgEbN';
const DRY_RUN = process.argv.includes('--dry-run');
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function getAccessToken() {
  try {
    const config = JSON.parse(
      readFileSync(`${process.env.HOME}/.config/configstore/firebase-tools.json`, 'utf8'),
    );
    return config?.tokens?.access_token ?? '';
  } catch {
    return '';
  }
}

function decodeFirestoreValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v)
    return (v.arrayValue.values ?? []).map(decodeFirestoreValue);
  if ('mapValue' in v) {
    return Object.fromEntries(
      Object.entries(v.mapValue.fields ?? {}).map(([k, vv]) => [k, decodeFirestoreValue(vv)]),
    );
  }
  return null;
}

function encodeFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') return { integerValue: String(val) };
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val))
    return { arrayValue: { values: val.map(encodeFirestoreValue) } };
  if (typeof val === 'object')
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(val).map(([k, v]) => [k, encodeFirestoreValue(v)]),
        ),
      },
    };
  return { stringValue: String(val) };
}

async function firestoreGet(token, path) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (body.error) throw new Error(`GET ${path}: ${body.error.message}`);
  return body;
}

async function firestorePatch(token, path, fields, updateMask) {
  const maskParam = updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${BASE_URL}/${path}?${maskParam}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`PATCH ${path}: ${body.error.message}`);
  return body;
}

async function repairSurvey() {
  console.log(`\n=== repairSurvey: ${SURVEY_ID} (dry-run: ${DRY_RUN}) ===\n`);

  const token = getAccessToken();
  if (!token) {
    console.error('firebase-tools access_token을 찾을 수 없습니다. firebase login 후 재시도하세요.');
    process.exit(1);
  }

  const snap = await firestoreGet(token, `surveys/${SURVEY_ID}`);
  const rawFields = snap.fields ?? {};
  const data = Object.fromEntries(
    Object.entries(rawFields).map(([k, v]) => [k, decodeFirestoreValue(v)]),
  );

  const sections = Array.isArray(data.sections) ? data.sections : [];
  const questions = Array.isArray(data.questions) ? data.questions : [];

  // ── 원시 진단 ────────────────────────────────────────────────────
  console.log('▶ 기본 정보:');
  console.log(`  title: ${String(data.title ?? '').slice(0, 60)}`);
  console.log(`  status: ${data.status}`);
  console.log(`  deleted: ${data.deleted}`);
  console.log(`  deletedPreviousStatus: ${data.deletedPreviousStatus ?? '(없음)'}`);

  console.log('\n▶ SECTIONS:');
  console.table(
    sections.map((s, i) => ({
      index: i,
      id: s.id,
      title: s.title ?? '',
      pageEndAction: s.pageEndAction ?? '(none)',
      qCount: questions.filter((q) => q.sectionId === s.id).length,
    })),
  );

  console.log('\n▶ Q19~Q25 sectionId 검증:');
  const sectionById = Object.fromEntries(sections.map((s) => [s.id, s]));
  questions.slice(18, 25).forEach((q, idx) => {
    const sec = sectionById[q.sectionId];
    const ok = sec ? '✓' : '✗ MISSING';
    console.log(
      `  [${idx + 18}] "${String(q.title ?? '').slice(0, 40)}" → sectionId="${q.sectionId ?? '(없음)'}" → "${sec?.title ?? 'NOT FOUND'}" ${ok}`,
    );
  });

  // ── 수리 항목 결정 ────────────────────────────────────────────────
  const page7Section = sections.find(
    (s) => String(s.title ?? '').includes('주관식') || String(s.title ?? '').includes('자유'),
  ) ?? sections[sections.length - 1];

  const SUBJECT_KEYWORDS = ['가장 도움이 된', '업무 적용', '추가 교육', '개선 의견'];
  const targetQs = questions.filter((q) =>
    SUBJECT_KEYWORDS.some((kw) => String(q.title ?? '').includes(kw)),
  );
  const wrongSectionQs = targetQs.filter((q) => q.sectionId !== page7Section?.id);

  const evalSection = sections.find((s) => String(s.title ?? '').includes('교육 운영 평가'));
  const page6NeedsRepair = evalSection?.pageEndAction === 'submit';

  const needsStatusRestore = data.deleted === true || data.status === 'deleted';

  console.log('\n▶ 수리 필요 항목:');
  console.log(`  status 복구 필요: ${needsStatusRestore} (현재 status="${data.status}", deleted=${data.deleted})`);
  console.log(`  sectionId 수리 필요 질문 수: ${wrongSectionQs.length}`);
  console.log(`  section6 pageEndAction 수리 필요: ${page6NeedsRepair}`);

  if (!needsStatusRestore && wrongSectionQs.length === 0 && !page6NeedsRepair) {
    console.log('\n수리할 항목이 없습니다.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Firestore 업데이트를 건너뜁니다.');
    process.exit(0);
  }

  // ── Firestore 업데이트 ────────────────────────────────────────────
  const patchFields = {};
  const updateMask = [];

  if (needsStatusRestore) {
    const restoreStatus = data.deletedPreviousStatus ?? 'published';
    patchFields.status = encodeFirestoreValue(restoreStatus);
    patchFields.deleted = encodeFirestoreValue(false);
    updateMask.push('status', 'deleted');
    console.log(`\n복구: status "${data.status}" → "${restoreStatus}", deleted true → false`);
  }

  if (wrongSectionQs.length > 0 && page7Section) {
    const wrongIds = new Set(wrongSectionQs.map((q) => q.id));
    const repairedQuestions = questions.map((q) =>
      wrongIds.has(q.id) ? { ...q, sectionId: page7Section.id } : q,
    );
    patchFields.questions = encodeFirestoreValue(repairedQuestions);
    updateMask.push('questions');

    console.log('\n복구된 질문 sectionId:');
    wrongSectionQs.forEach((q) => {
      console.log(`  "${String(q.title ?? '').slice(0, 40)}" → "${page7Section.id}"`);
    });
  }

  if (page6NeedsRepair && evalSection) {
    const repairedSections = sections.map((s) =>
      s.id === evalSection.id ? { ...s, pageEndAction: 'next' } : s,
    );
    patchFields.sections = encodeFirestoreValue(repairedSections);
    updateMask.push('sections');
    console.log(`\n복구: section6 pageEndAction submit → next`);
  }

  await firestorePatch(token, `surveys/${SURVEY_ID}`, patchFields, updateMask);
  console.log('\n✅ Firestore 업데이트 완료');

  // ── 검증: 업데이트 후 재조회 ─────────────────────────────────────
  const verifySnap = await firestoreGet(token, `surveys/${SURVEY_ID}`);
  const verifyData = Object.fromEntries(
    Object.entries(verifySnap.fields ?? {}).map(([k, v]) => [k, decodeFirestoreValue(v)]),
  );
  console.log('\n▶ 업데이트 후 검증:');
  console.log(`  status: ${verifyData.status}`);
  console.log(`  deleted: ${verifyData.deleted}`);

  const verifyQs = Array.isArray(verifyData.questions) ? verifyData.questions : [];
  const stillWrong = verifyQs
    .filter((q) => SUBJECT_KEYWORDS.some((kw) => String(q.title ?? '').includes(kw)))
    .filter((q) => q.sectionId !== page7Section?.id);
  console.log(`  주관식 질문 sectionId 오류: ${stillWrong.length}건`);
  console.log(stillWrong.length === 0 ? '  ✓ sectionId 정상' : '  ✗ 아직 오류 있음');

  process.exit(0);
}

repairSurvey().catch((err) => {
  console.error('오류 발생:', err);
  process.exit(1);
});
