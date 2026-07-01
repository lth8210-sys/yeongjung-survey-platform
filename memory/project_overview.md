---
name: project-overview
description: 영중폼 설문 플랫폼 전반 구조 — Firebase/React SPA, 내부직원 전용 관리 앱
metadata:
  type: project
---

영중종합사회복지관 내부 설문 관리 플랫폼. Vite + React + Firebase (Firestore, Auth).

- 내부 이메일(@yeongjung.or.kr)만 관리자 접근 가능
- 역할: super_admin > admin > creator > viewer
- super_admin 이메일 hardcode: lth8210@yeongjung.or.kr, yj100@yeongjung.or.kr
- Firestore Rules와 src/firebase/users.js 동기화 필수 (SYNC REQUIRED 주석 확인)
- 주요 파일: src/firebase/surveys.js (대형), src/firebase/users.js, src/contexts/AuthContext.jsx
- 폼 유형: general_survey, satisfaction, needs_survey, application
- Quota 기능: 권역/연령대 할당표본(region_age mode)

**Why:** 사회복지기관 실무 운영 도구로 안정성과 개인정보 보호 최우선
**How to apply:** 기능 추가보다 Minimal Change 원칙, 기존 함수 교체 금지, Wrapper/Utility 추가 방식
