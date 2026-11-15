#!/usr/bin/env python3
"""편집 가능한 SVG를 생성하며 PNG·PDF 변환은 별도로 실행합니다."""
from pathlib import Path
import base64
import html

HERE = Path(__file__).resolve().parent
W, H = 2400, 1810
parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs>
<style>text{{font-family:'Apple SD Gothic Neo','Noto Sans CJK KR',Arial,sans-serif;fill:#172b42}} .muted{{fill:#516477}} .label{{font-size:22px;font-weight:600}} .small{{font-size:20px}} .tiny{{font-size:18px}}</style>
<marker id="blue" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#2069ae"/></marker>
<marker id="green" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#18836a"/></marker>
<marker id="orange" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#d77b0d"/></marker>
<marker id="gray" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#7f8e9b"/></marker>
</defs><rect width="2400" height="1810" fill="white"/>''']


def rect(x, y, w, h, fill="white", stroke="#c9d3dd", r=8, dash=None, sw=2):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"' + (f' stroke-dasharray="{dash}"' if dash else '') + '/>')


def text(x, y, content, size=22, weight=400, color="#172b42", anchor="start"):
    parts.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{html.escape(content)}</text>')


def icon(key, x, y, size=64):
    data = base64.b64encode((HERE / "assets" / (key + ".svg")).read_bytes()).decode()
    parts.append(f'<image x="{x}" y="{y}" width="{size}" height="{size}" xlink:href="data:image/svg+xml;base64,{data}"/>')


def line(points, color="blue", dash=None, width=3):
    colors = {"blue": "#2069ae", "green": "#18836a", "orange": "#d77b0d", "gray": "#7f8e9b"}
    parts.append('<polyline points="' + ' '.join(f'{x},{y}' for x, y in points) + f'" fill="none" stroke="{colors[color]}" stroke-width="{width}" stroke-linejoin="round" marker-end="url(#{color})"' + (f' stroke-dasharray="{dash}"' if dash else '') + '/>')


def label(x, y, s, color="#2069ae", size=19):
    width = len(s) * size * .57 + 20
    rect(x - 8, y - size, width, size + 10, "white", "none", 3, sw=0)
    text(x, y, s, size, 600, color)


def card(x, y, w, h, key, title, rows, fill="white"):
    rect(x, y, w, h, fill)
    icon(key, x + 18, y + 18, 56)
    text(x + 88, y + 43, title, 23, 700)
    for i, s in enumerate(rows):
        text(x + 20, y + 100 + i * 30, s, 20)


text(42, 57, "Think Meet · AWS EKS 운영 아키텍처", 38, 700)
text(43, 96, "서울 리전 · 여러 소규모 수업 합계 동접 1,000명 · 50개 수업 × 20명 기준의 검증 시작 설계", 23, 400, "#516477")
rect(260, 130, 2100, 1530, "#ffffff", "#34475b", 0, sw=2)
icon("aws", 278, 143, 40)
text(330, 174, "AWS Cloud", 27, 700)
text(2300, 174, "ap-northeast-2 / 3 Availability Zones", 23, 600, anchor="end")

# 클라이언트와 전역 edge 계층입니다.
rect(30, 280, 180, 175, "#f2f7fb", "#c2d3e1")
parts.append('<circle cx="120" cy="322" r="17" fill="#2069ae"/><path d="M91 370 Q91 342 120 342 Q149 342 149 370Z" fill="#2069ae"/>')
text(120, 406, "교사 · 학생", 22, 700, anchor="middle")
text(120, 436, "브라우저 / 앱", 20, anchor="middle")

card(320, 215, 280, 205, "route53", "Route 53", ["class.example.com", "origin. / rtc. / turn."])
card(710, 215, 850, 205, "cloudfront", "CloudFront + AWS WAF", ["정적 웹 캐시 · API/Socket.IO 캐시 금지", "쿠키·Origin 전달 / 동일 출처 HTTPS"], "#faf7fe")
icon("waf", 1450, 235, 54)
card(1850, 215, 450, 205, "s3", "Private S3 · 웹", ["빌드된 React 정적 파일", "OAC 서명 요청만 허용"], "#f6fbf4")
line([(210, 315), (235, 315), (235, 202), (670, 202), (670, 290), (710, 290)])
label(435, 200, "HTTPS 443", size=18)
line([(1560, 290), (1850, 290)])
label(1610, 275, "OAC / HTTPS")
line([(460, 420), (460, 450), (650, 450), (650, 420)], "gray", "6 5", 2)
text(470, 479, "DNS만 제공 · 모든 HTTP 경로를 경유하는 프록시는 아님", 18, color="#516477")

# VPC와 논리적 서브넷 그룹이며 각 그룹은 3개 AZ에 걸쳐 구성합니다.
rect(300, 510, 2020, 920, "#fcfefc", "#43824d", 0, sw=3)
text(325, 550, "VPC 10.40.0.0/16 · 각 서브넷 그룹은 3개 AZ에 분산", 26, 700, "#357346")
rect(340, 590, 300, 740, "#fffaf3", "#d49a4f", 0)
rect(700, 590, 460, 740, "#f4f9fd", "#7c9ab8", 0)
rect(1220, 590, 480, 740, "#f7f6fc", "#8d85b5", 0)
rect(1760, 590, 520, 740, "#fff9f0", "#d49a4f", 0)
for x, title, sub in [(360, "Public · Ingress", "3 AZ / ALB · NLB · NAT"), (720, "Private · Application", "3 AZ / EKS app nodes"), (1240, "Isolated · Data", "3 AZ / 인터넷 기본 경로 없음"), (1780, "Public · Media", "3 AZ / EKS 전용 SFU nodes")]:
    text(x, 623, title, 23, 700)
    text(x, 651, sub, 18, color="#516477")

card(360, 685, 260, 185, "alb", "ALB", ["HTTPS / WSS 443", "인증 API + RTC 신호"])
card(720, 685, 420, 185, "eks", "NestJS API", ["목표 3–12 pods / HPA", "현재 코드 호환 배포: 1 pod"], "#ffffff")
card(1240, 685, 440, 185, "aurora", "Aurora PostgreSQL", ["Writer 1 + Readers 2 / 3 AZ", "TLS RDS Proxy · PITR 35일"])
line([(620, 770), (720, 770)])
line([(1140, 770), (1240, 770)])
label(1170, 750, "TLS", size=17)

card(720, 1030, 420, 165, "eks", "RTC 입장 인증 Gateway", ["3 pods / 서버 권한 재검사", "신호 7880은 내부에만 노출"])
card(360, 1030, 260, 165, "nlb", "TURN NLB", ["TLS 443 → TCP 5349", "ACM / PROXY v2"])
card(1240, 945, 440, 150, "redis", "Redis · Application", ["Primary + Replicas 2 / TLS"])
card(1240, 1135, 440, 150, "redis", "Redis · LiveKit", ["Primary + Replicas 2 / TLS"])
line([(930, 870), (930, 945), (1240, 1015)], "blue")
label(960, 933, "앱 분산 처리 보완 후 사용", size=18)
line([(490, 870), (490, 910), (670, 910), (670, 1080), (720, 1080)])
label(495, 899, "rtc. / WSS", size=18)
line([(1140, 1090), (1190, 1090), (1190, 910), (1730, 910), (1730, 750), (1780, 750)])
label(1350, 899, "Gateway → LiveKit :7880", size=18)

for i, az in enumerate(("AZ-a", "AZ-b", "AZ-c")):
    y = 685 + i * 215
    card(1780, y, 480, 175, "ec2", "LiveKit SFU · " + az, ["2 × c7i.4xlarge / On-Demand", "hostNetwork · 1 pod / node"])
    text(2228, y + 40, "×2", 23, 700, "#a35e08", anchor="end")

# 직접 통신 경로는 HTTP 로드밸런서를 거치지 않으며 화살표가 구성 요소 이름을 가리지 않게 배치합니다.
line([(120, 455), (120, 770), (360, 770)])
label(30, 708, "RTC WSS 443", size=18)
line([(120, 820), (120, 1105), (360, 1105)], "orange")
label(25, 1005, "TURN TLS 443", "#a35e08", 18)
line([(620, 1140), (660, 1140), (660, 1380), (1715, 1380), (1715, 1265), (1780, 1265)], "orange")
label(910, 1370, "TURN fallback → SFU / relay UDP 30000–40000", "#a35e08", 18)
line([(120, 1195), (120, 1470), (2030, 1470), (2030, 1290)], "green", width=4)
label(500, 1458, "DTLS-SRTP · 직접 ICE UDP 7882–7897 / TCP 7881 · ALB·CloudFront 우회", "#16765f", 20)
line([(1780, 1210), (1680, 1210)], "blue")

icon("nat", 360, 1243, 42)
text(414, 1270, "NAT ×3", 21, 700)
text(360, 1307, "앱의 AZ별 외부 통신", 18, color="#516477")
icon("igw", 2160, 1350, 42)
text(1840, 1380, "IGW · 실제 공인 IPv4", 20, 600, "#16765f")
line([(1560, 350), (1730, 350), (1730, 570), (650, 570), (650, 715), (620, 715)])
label(1210, 494, "API / Socket.IO → origin. ALB / HTTPS", size=19)

# VPC 외부의 관리형 서비스와 운영 계층입니다.
rect(320, 1520, 1980, 115, "#f8fafc", "#c3cdd6")
for x, key, title, sub in [(345, "eks", "EKS Control Plane", "1.36 / API 접근 제한"), (735, "ecr", "ECR", "불변 이미지 / 스캔"), (1035, "secrets", "Secrets Manager + KMS", "IRSA / 자격증명 암호화"), (1585, "cloudwatch", "CloudWatch", "DB·Redis 경보 / 로그"), (1960, "prometheus", "Managed Prometheus", "SFU·컨테이너 지표")]:
    icon(key, x, 1540, 48)
    text(x + 60, 1565, title, 21, 700)
    text(x + 60, 1595, sub, 18, color="#516477")
text(345, 1504, "수업 자료: API 권한 검사 → Private S3 (버전 관리·KMS) / 앱 → S3 Gateway Endpoint", 21, 600)
icon("s3", 2260, 1455, 40)

# 범례와 제약을 설계도에 표시하며 실제 수용량은 부하 시험으로 검증해야 합니다.
line([(40, 1704), (105, 1704)], "blue")
text(120, 1712, "HTTPS · WSS · 내부 제어", 21, 600)
line([(490, 1704), (555, 1704)], "green")
text(570, 1712, "영상·음성 직접 전송", 21, 600)
line([(930, 1704), (995, 1704)], "orange")
text(1010, 1712, "TURN 우회", 21, 600)
text(1290, 1712, "실선 = 통신 / 배치는 논리 구조, 축척 없음", 20, color="#516477")
text(42, 1753, "운영 전제: API 분산 처리 보완 + 1,000명 실측 + 1 AZ 장애 검증. 단일 방은 한 SFU에 배치되며 SFU 장애 시 재입장이 필요합니다.", 22, 600)
text(42, 1788, "설계 2026-11-07 · 공식 AWS 아이콘 (2026-07) · Terraform은 제공 파일이며 AWS에 아직 적용하지 않았습니다.", 20, color="#516477")
parts.append('</svg>')
(HERE / "aws-architecture.svg").write_text('\n'.join(parts))
print("Wrote editable aws-architecture.svg")
