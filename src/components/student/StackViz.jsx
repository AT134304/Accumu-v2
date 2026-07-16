// Accumu v2 — 마일스톤 스택 시각화 (Accumu_prototype.html buildStack() 852줄)
//
// [빈 상태 — participations 도입 시 실제 데이터 연결] (docs/specs/student-home.md 확정 G)
//   참여 기록을 담을 participations 테이블이 아직 없다. v2 목표가 "실제로 작동하는 프로토타입"이므로
//   가짜 데이터를 하드코딩하지 않는다. 지금은 레이아웃(기둥 5개 × 4블록 + grow 애니메이션)만 재현하고
//   블록은 전부 빈 블록(.blk)으로 둔다.
//   -> 프로토타입의 채워진 블록(.fill / .fill.i / .fill.a)과 색 매핑(1/2/3 -> blue/indigo/amber)은
//      이번 스코프에 등장하지 않으며, 새 의미를 부여하지도 않는다.
import { recentMonthCaptions } from '../../lib/date';

const COLS = 5; // 기둥(월) 수
const BLOCKS = 4; // 기둥당 블록 수

export default function StackViz() {
  // 월 캡션은 실제 오늘 기준 최근 5개월(가장 오른쪽 = '이번 달').
  // 프로토타입의 ['3월','4월','5월','6월','이번 달']은 TODAY_ISO 고정 전제의 하드코딩이라 쓰지 않는다.
  const caps = recentMonthCaptions(COLS);

  return (
    // 아직 담고 있는 정보가 없는 장식 요소라 스크린리더에서는 감춘다.
    <div className="stackviz" aria-hidden="true">
      {caps.map((cap, ci) => (
        <div className="col" key={cap}>
          {Array.from({ length: BLOCKS }, (_, bi) => (
            <div
              className="blk"
              key={bi}
              // 아래->위로 순차 등장 (프로토타입 animation-delay 계산식 그대로)
              style={{ animationDelay: `${ci * 0.08 + bi * 0.05}s` }}
            />
          ))}
          <div className="cap">{cap}</div>
        </div>
      ))}
    </div>
  );
}
