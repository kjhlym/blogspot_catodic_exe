export type NaverSearchType = 'news' | 'blog' | 'shop' | 'web'; // web 타입 추가

export type CurationPresetQuery = {
  query: string;
  searchType: NaverSearchType;
  domain?: string; // 특정 도메인 검색 지원
};

export type CurationPresetGroup = {
  id: string;
  label: string;
  description: string;
  domain: 'catodic' | 'lifeculture';
  audience: 'technical' | 'common' | 'expert';
  queries: CurationPresetQuery[];
};

export const CURATION_PRESET_GROUPS: CurationPresetGroup[] = [
  {
    id: 'cp-standards',
    label: '국제 기술 표준 분석',
    description: 'AMPP(NACE), API, ISO/EN 등 국제 표준 규격의 최신 동향 및 해석',
    domain: 'catodic',
    audience: 'expert',
    queries: [
      { query: 'AMPP SP0169-2015 Control of External Corrosion on Underground or Submerged Metallic Piping Systems', searchType: 'web', domain: 'ampp.org' },
      { query: 'API RP 571 Damage Mechanisms Affecting Fixed Equipment in the Refining Industry', searchType: 'web', domain: 'api.org' },
      { query: 'ISO 15589-1 Petroleum, petrochemical and natural gas industries — Cathodic protection of pipeline systems', searchType: 'web', domain: 'iso.org' },
      { query: 'NACE TM0497 Measurement Techniques Related to Criteria for Cathodic Protection', searchType: 'web', domain: 'ampp.org' },
      { query: 'Corrosion control for reinforced concrete structures ISO 12696', searchType: 'web', domain: 'iso.org' },
    ],
  },
  {
    id: 'cp-research',
    label: '학술 정보 및 최신 연구',
    description: 'Google Scholar 및 RISS 기반의 부식 방지 및 전기방식 신기술 연구 논문 요약',
    domain: 'catodic',
    audience: 'technical',
    queries: [
      { query: 'latest trends in smart cathodic protection remote monitoring systems', searchType: 'web', domain: 'scholar.google.com' },
      { query: 'mathematical modeling of cathodic protection interference', searchType: 'web', domain: 'sciencedirect.com' },
      { query: 'innovative sacrificial anode materials for deep water applications', searchType: 'web', domain: 'scholar.google.com' },
      { query: 'cathodic protection for offshore wind turbine foundations', searchType: 'web', domain: 'ieeexplore.ieee.org' },
      { query: 'application of graphene in corrosion protection coatings', searchType: 'web', domain: 'scholar.google.com' },
    ],
  },
  {
    id: 'cp-corporate-blogs',
    label: '글로벌 기업 기술 블로그',
    description: 'Matcor, Cathodic Protection Co Ltd 등 글로벌 선도 기업의 실무 사례 및 기술 리포트',
    domain: 'catodic',
    audience: 'technical',
    queries: [
      { query: 'deep well groundbed design case studies', searchType: 'web', domain: 'matcor.com' },
      { query: 'internal corrosion monitoring vs cathodic protection', searchType: 'web', domain: 'cathodic.co.uk' },
      { query: 'marine structure cathodic protection maintenance guide', searchType: 'web', domain: 'bacgroup.com' },
      { query: 'stray current interference mitigation on pipeline', searchType: 'web', domain: 'matcor.com' },
      { query: 'AC mitigation for pipelines co-located with HVDC lines', searchType: 'web', domain: 'corrosion.com' },
    ],
  },
  {
    id: 'cp-ai-curation',
    label: 'AI 및 실무 실전 가이드',
    description: '실무 Q&A, 용어 해설, 점검 리스트 등 실전 업무에 즉시 활용 가능한 콘텐츠',
    domain: 'catodic',
    audience: 'common',
    queries: [
      { query: '전기방식 전위 측정시 IR Drop 현상과 제거 방법 가이드', searchType: 'web' },
      { query: '희생양극법과 외부전원법의 경제성 및 기술적 비교 선택', searchType: 'web' },
      { query: '배관 전기방식 원격 감시 시스템(RMS) 도입 효과 및 비용', searchType: 'web' },
      { query: '전기방식 설비 정기 점검 시 법적 필수 측정 항목 리스트', searchType: 'web' },
      { query: '전기방식 최신 동향', searchType: 'web' },
      { query: '도시가스 배관 부식 방지', searchType: 'web' },
      { query: 'Smart Cathodic Protection trends', searchType: 'web' },
      { query: 'Corrosion protection industry news', searchType: 'web' },
    ],
  },
  {
    id: 'cp-measurement',
    label: '전위 측정 및 해석',
    description: 'IR Drop 제거, 기준전극 관리, 유도 협착 판별 등 데이터 분석 영역',
    domain: 'catodic',
    audience: 'expert',
    queries: [
      { query: 'OFF 전위(Instant Off Potential) 측정 시 IR Drop 제거 테크닉', searchType: 'web' },
      { query: '포화황산동 기준전극 전해질 농도가 측정값에 미치는 영향', searchType: 'web' },
      { query: '고압 송전선 유도 협착(AC Interference) 판별과 저감 대책', searchType: 'web' },
    ],
  },
  {
    id: 'cp-engineering',
    label: '정류기 및 시스템 설계',
    description: '심매설 양극 가스 폐쇄 방지, 다중 배관 간섭 해결 등 엔지니어링 영역',
    domain: 'catodic',
    audience: 'expert',
    queries: [
      { query: '심매설 양극(Deep Well Anode) 시공 시 가스 폐쇄(Gas Blocking) 방지', searchType: 'web' },
      { query: '정류기 출력 전압 정상이나 전류 0인 경우 단선 지점 탐지', searchType: 'web' },
      { query: '다중 배관 밀집 지역 상호 간섭(Interaction) 및 차폐 효과 해결', searchType: 'web' },
    ],
  },
  {
    id: 'cp-materials',
    label: '양극 및 재질 특성',
    description: '기수역 양극 효율, 고비저항 지역 양극 배치 등 자재 선정 영역',
    domain: 'catodic',
    audience: 'technical',
    queries: [
      { query: '기수역(Brackish Water) 아연 양극 대비 알루미늄 양극 효율 비교', searchType: 'web' },
      { query: '마그네슘 양극 선택 시 토양 비저항 기준 및 배치 간격', searchType: 'web' },
      { query: '불용성 양극(MMO Anode) 코팅 탈락 원인과 수명 연장 전류 제한', searchType: 'web' },
    ],
  },
  {
    id: 'cp-construction',
    label: '시공 및 유지관리',
    description: '피복별 전류 요구량, 절연 조인트 점검, 조간대 부식 방지 등 현장 실무',
    domain: 'catodic',
    audience: 'technical',
    queries: [
      { query: '배관 피복(Coating) 종류에 따른 방식 전류 밀도 설계 상수', searchType: 'web' },
      { query: '절연 조인트(Insulating Joint) 성능 검사 및 서지 어레스터 점검', searchType: 'web' },
      { query: '해상 교량 기초(Piling) 조간대(Splash Zone) 부식 방지 보완책', searchType: 'web' },
    ],
  },
  {
    id: 'cp-trends',
    label: '법규 및 최신 트렌드',
    description: 'KGS 검사 기준 변경, 수소 배관 전기방식 등 신뢰도 관리 영역',
    domain: 'catodic',
    audience: 'expert',
    queries: [
      { query: '2026년 개정 KGS 전기방식 검사 기준 주요 변경점 분석', searchType: 'web' },
      { query: '수소 배관(Hydrogen Pipeline) 상용화와 수소 취성 방지 전압 제한', searchType: 'web' },
      { query: '전기방식 원격 모니터링 데이터 인정 범위 및 현장 측정 주기', searchType: 'web' },
    ],
  },
  {
    id: 'life-health',
    label: '건강 & 웰니스',
    description: '원활한 일상을 위한 홈트, 명상, 건강 식단 및 생활 습관 가이드',
    domain: 'lifeculture',
    audience: 'common',
    queries: [
      { query: '집에서 하는 15분 전신 스트레칭 루틴', searchType: 'blog' },
      { query: '면역력 높이는 제철 음식과 건강 식단 추천', searchType: 'news' },
      { query: '직장인 거북목 예방을 위한 올바른 자세 가이드', searchType: 'web' },
      { query: '명상과 마음 챙김을 위한 무료 앱 및 명상법', searchType: 'blog' },
      { query: '충분한 숙면을 위한 수면 환경 조성 꿀팁', searchType: 'blog' },
    ],
  },
  {
    id: 'life-home',
    label: '홈 인테리어 & 리빙',
    description: '아늑한 나의 공간을 위한 가구 배치, 인테리어 팁, 리빙 아이템',
    domain: 'lifeculture',
    audience: 'common',
    queries: [
      { query: '좁은 방 넓어 보이는 가구 배치 및 조명 인테리어', searchType: 'blog' },
      { query: '에너지 절약을 위한 스마트 홈 가전 활용 사례', searchType: 'news' },
      { query: '사무실 책상 위 힐링을 주는 반려식물 키우기', searchType: 'blog' },
      { query: '미니멀리즘 인테리어를 위한 수납 정리 노하우', searchType: 'web' },
      { query: '가성비 좋은 자취방 인테리어 아이템 추천', searchType: 'shop' },
    ],
  },
  {
    id: 'life-growth',
    label: '자기계발 & 지식',
    description: '끊임없는 성장을 위한 노션 활용, 학습 팁, 커리어 가이드',
    domain: 'lifeculture',
    audience: 'common',
    queries: [
      { query: '노션(Notion)을 활용한 개인 기록 및 플래너 작성법', searchType: 'blog' },
      { query: '외국어 학습 효율을 높이는 AI 튜터 서비스 비교', searchType: 'web' },
      { query: '독서 습관을 길러주는 도서 기록 앱 및 북클럽', searchType: 'blog' },
      { query: '직장인 자기계발을 위한 무료 온라인 자격증 강의', searchType: 'news' },
      { query: '효율적인 시간 관리를 위한 뽀모도로 기법 활용', searchType: 'blog' },
    ],
  },
  {
    id: 'life-leisure',
    label: '여행 & 취미 생활',
    description: '삶의 활기를 더하는 국내외 여행지, 캠핑, 디지털 취미 정보',
    domain: 'lifeculture',
    audience: 'common',
    queries: [
      { query: '국내 조용하고 고즈넉한 소도시 여행지 베스트', searchType: 'news' },
      { query: '캠핑 입문자를 위한 가성비 캠핑 용품 리스트', searchType: 'shop' },
      { query: '아이패드로 시작하는 디지털 드로잉 입문 가이드', searchType: 'web' },
      { query: '비 오는 날 집에서 즐기는 넷플릭스 영화 추천', searchType: 'blog' },
      { query: '주말 국내 당일치기 기차 여행 코스 추천', searchType: 'news' },
    ],
  },
  {
    id: 'life-tech',
    label: 'IT & 디지털 트렌드',
    description: '스마트한 생활을 위한 유용한 앱, AI 도구, 보안 가이드',
    domain: 'lifeculture',
    audience: 'common',
    queries: [
      { query: '크롬 확장 프로그램 추천 생산성 향상 도구 모음', searchType: 'web' },
      { query: '생성형 AI 챗GPT(ChatGPT) 실무 활용 꿀팁', searchType: 'blog' },
      { query: '스마트폰 개인 정보 보안 및 2단계 인증 설정', searchType: 'blog' },
      { query: '스마트폰 배터리 수명 연장을 위한 최적화 방법', searchType: 'web' },
      { query: '일상 생활에 도움이 되는 신기한 AI 서비스들', searchType: 'news' },
    ],
  },
];

export function getCurationPresetGroup(groupId: string) {
  return CURATION_PRESET_GROUPS.find((group) => group.id === groupId);
}



