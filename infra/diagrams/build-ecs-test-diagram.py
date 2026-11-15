#!/usr/bin/env python3
"""이전 ECS 테스트 구성을 편집 가능한 SVG와 diagrams.net 기본 셀로 생성합니다.

이 스크립트 실행 후 render-ecs-test-diagram.cjs로 PNG·PDF를 생성합니다.
AWS 아이콘은 assets/NOTICE.md에 기록된 공식 패키지의 로컬 벡터를 사용합니다.
"""
from pathlib import Path
import base64
import html
import urllib.parse
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
W, H = 2600, 1880
INK = "#243247"
MUTED = "#58677b"
BLUE = "#2667a8"
GREEN = "#168066"
ORANGE = "#d27914"
GRAY = "#8290a0"
SVG = [f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<title>Think Meet ECS test architecture</title>
<desc>Fargate API and admission gateway, dedicated EC2 LiveKit, RDS PostgreSQL and two single-node Redis groups. Target: load testing at 50 or more concurrent participants. Capacity has not been measured. Single-instance services have no high availability.</desc>
<defs><style>text{{font-family:'Apple SD Gothic Neo','Noto Sans CJK KR',Arial,sans-serif}}</style>''']
for key, color in (("blue", BLUE), ("green", GREEN), ("orange", ORANGE), ("gray", GRAY)):
    SVG.append(f'<marker id="arrow-{key}" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L9,4 L0,8 Z" fill="{color}"/></marker>')
SVG.append('</defs><rect width="2600" height="1880" fill="#ffffff"/>')

mxfile = ET.Element("mxfile", {"host": "app.diagrams.net", "modified": "2026-11-10T00:00:00.000Z", "agent": "Think Meet architecture generator", "version": "24.7.17", "type": "device"})
diagram = ET.SubElement(mxfile, "diagram", {"id": "think-meet-ecs-test", "name": "ECS test architecture"})
model = ET.SubElement(diagram, "mxGraphModel", {"dx": str(W), "dy": str(H), "grid": "1", "gridSize": "10", "guides": "1", "tooltips": "1", "connect": "1", "arrows": "1", "fold": "1", "page": "1", "pageScale": "1", "pageWidth": str(W), "pageHeight": str(H), "math": "0", "shadow": "0"})
mxroot = ET.SubElement(model, "root")
ET.SubElement(mxroot, "mxCell", {"id": "0"})
ET.SubElement(mxroot, "mxCell", {"id": "1", "parent": "0"})
serial = 1


def cell(value, style, x, y, width, height, **attrs):
    global serial
    serial += 1
    node = ET.SubElement(mxroot, "mxCell", {"id": str(serial), "value": value, "style": style, "vertex": "1", "parent": "1", **attrs})
    ET.SubElement(node, "mxGeometry", {"x": str(x), "y": str(y), "width": str(width), "height": str(height), "as": "geometry"})
    return node


def rect(x, y, width, height, fill="#ffffff", stroke="#ccd5df", radius=8, sw=2, dash=None):
    SVG.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"' + (f' stroke-dasharray="{dash}"' if dash else '') + '/>')
    style = f'rounded={int(radius > 0)};whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth={sw};'
    if dash:
        style += 'dashed=1;dashPattern=6 4;'
    cell("", style, x, y, width, height)


def text(x, y, value, size=22, weight=400, color=INK, anchor="start"):
    SVG.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{html.escape(value)}</text>')
    # 기본 텍스트 셀을 사용해 diagrams.net 문서를 계속 편집할 수 있게 합니다.
    width = sum(size * (1.0 if ord(c) > 255 else .6) for c in value) + 8
    left = x if anchor == "start" else x - width / (2 if anchor == "middle" else 1)
    cell(value, f'text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontFamily=Arial;fontSize={size};fontStyle={1 if weight >= 600 else 0};fontColor={color};spacing=0;', left, y - size, width, size * 1.3)


def icon(key, x, y, size=58):
    source = (HERE / "assets" / (key + ".svg")).read_bytes()
    data = base64.b64encode(source).decode()
    uri = "data:image/svg+xml;base64," + data
    SVG.append(f'<image x="{x}" y="{y}" width="{size}" height="{size}" xlink:href="{uri}"/>')
    # diagrams.net은 스타일 필드를 세미콜론으로 구분하므로 base64 구분자를 넣지 않고
    # 일반 SVG 데이터 URI를 퍼센트 인코딩합니다.
    drawio_uri = "data:image/svg+xml," + urllib.parse.quote(source.decode(), safe="")
    cell("", f'shape=image;imageAspect=0;aspect=fixed;image={drawio_uri};', x, y, size, size)


def line(points, kind="blue", width=3, dash=None, arrow=True):
    global serial
    color = {"blue": BLUE, "green": GREEN, "orange": ORANGE, "gray": GRAY}[kind]
    SVG.append('<polyline points="' + ' '.join(f'{x},{y}' for x, y in points) + f'" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"' + (f' marker-end="url(#arrow-{kind})"' if arrow else '') + (f' stroke-dasharray="{dash}"' if dash else '') + '/>')
    serial += 1
    edge = ET.SubElement(mxroot, "mxCell", {"id": str(serial), "style": f'edgeStyle=none;html=1;rounded=0;strokeColor={color};strokeWidth={width};endArrow={"block" if arrow else "none"};endFill=1;' + ('dashed=1;dashPattern=6 4;' if dash else ''), "edge": "1", "parent": "1"})
    geometry = ET.SubElement(edge, "mxGeometry", {"relative": "1", "as": "geometry"})
    ET.SubElement(geometry, "mxPoint", {"x": str(points[0][0]), "y": str(points[0][1]), "as": "sourcePoint"})
    ET.SubElement(geometry, "mxPoint", {"x": str(points[-1][0]), "y": str(points[-1][1]), "as": "targetPoint"})
    if len(points) > 2:
        waypoints = ET.SubElement(geometry, "Array", {"as": "points"})
        for x, y in points[1:-1]:
            ET.SubElement(waypoints, "mxPoint", {"x": str(x), "y": str(y)})


def tag(x, y, value, color=BLUE, size=18, background="#ffffff"):
    width = sum(size * (1.0 if ord(c) > 255 else .55) for c in value) + 16
    rect(x - 7, y - size, width, size + 8, background, "none", 3, sw=0)
    text(x, y, value, size, 600, color)


def card(x, y, width, height, key, title, rows, fill="#ffffff", title_size=23, row_size=20):
    rect(x, y, width, height, fill)
    icon(key, x + 18, y + 18, 54)
    text(x + 87, y + 43, title, title_size, 700)
    for i, value in enumerate(rows):
        text(x + 20, y + 100 + i * 30, value, row_size)


# 제목과 전역 서비스입니다.
text(42, 59, "Think Meet  |  ECS 테스트 아키텍처", 38, 700)
text(43, 99, "동시 50명 이상 부하 시험 목표 · Fargate API + EC2 LiveKit · 용량 실측 전 · 단일 인스턴스 / HA 없음", 23, color=MUTED)
rect(270, 135, 2290, 1595, "#ffffff", "#34475b", 0, sw=2)
icon("aws", 291, 151, 42)
text(345, 182, "AWS Cloud", 27, 700)
text(2516, 182, "Global edge + ap-northeast-2 (Seoul)", 22, 600, anchor="end")

# 외부 클라이언트에서 브라우저별 통신 경로가 시작됩니다.
rect(40, 250, 170, 180, "#f3f7fb", "#b9cbdc")
SVG.append(f'<circle cx="125" cy="292" r="18" fill="{BLUE}"/><path d="M93 344 Q93 313 125 313 Q157 313 157 344Z" fill="{BLUE}"/>')
cell("", f'shape=actor;fillColor={BLUE};strokeColor={BLUE};', 93, 274, 64, 70)
text(125, 378, "교사 · 학생", 22, 700, anchor="middle")
text(125, 408, "브라우저", 20, anchor="middle")
card(340, 230, 300, 160, "route53", "Route 53", ["테스트 전용 도메인", "origin. / rtc. / turn."], row_size=19)
card(760, 230, 800, 160, "cloudfront", "CloudFront", ["정적 웹 캐시 / API·Socket.IO 캐시 비활성화", "동일 출처 HTTPS · WAF는 선택 구성, 기본 비활성화"], fill="#fbf8fe")
card(2060, 230, 410, 160, "s3", "Private S3 · 웹", ["React 정적 파일", "OAC 서명 요청만 허용"], fill="#f6fbf3")
line([(210, 290), (340, 290)], "gray", 2, "6 5")
tag(243, 277, "DNS", GRAY, 17)
line([(210, 365), (250, 365), (250, 445), (715, 445), (715, 305), (760, 305)])
tag(413, 435, "① 웹 · HTTPS 443", size=19)
line([(1560, 305), (2060, 305)])
tag(1715, 292, "OAC / HTTPS", size=19)

# 리전·VPC·논리적 서브넷 경계입니다.
rect(315, 480, 2210, 1220, "#ffffff", "#87a0b9", 0, dash="9 6")
tag(338, 480, "AWS Region · ap-northeast-2 / 2 Availability Zones", "#516b88", 22)
rect(340, 525, 2160, 875, "#fcfefc", "#43824d", 0, sw=3)
text(365, 562, "VPC 10.42.0.0/16", 25, 700, "#357346")
text(2473, 560, "2 AZ 서브넷 · NAT 0 · EKS 없음", 21, 600, "#357346", anchor="end")

for x, width, fill, stroke, title, subtitle in (
    (370, 300, "#fffaf2", "#d5a25c", "Public · Ingress", "ALB / NLB · 2 AZ"),
    (710, 580, "#f5f9fd", "#839fb8", "Public · Application", "Fargate task ENI · 2 AZ 중 1곳"),
    (1330, 650, "#fffaf2", "#d5a25c", "Public · Media", "EC2 전용 용량 · 첫 번째 AZ"),
    (2020, 450, "#f7f6fc", "#9284b4", "Isolated · Data", "2 AZ subnet group / active: 1 AZ"),
):
    rect(x, 595, width, 770, fill, stroke, 0)
    text(x + 18, 630, title, 23, 700)
    text(x + 18, 660, subtitle, 18, color=MUTED)

card(390, 710, 260, 165, "alb", "ALB", ["HTTPS / WSS 443", "API + RTC 신호"])
card(390, 1120, 260, 165, "nlb", "TURN NLB", ["TLS 443 → 5349", "ACM / PROXY v2"], row_size=19)

# API와 입장 검사 Gateway를 Fargate 태스크 1개에 함께 배치합니다.
rect(735, 710, 530, 460, "#ffffff", "#d17d20", 10, sw=2)
icon("fargate", 755, 729, 56)
text(828, 753, "Fargate Task ×1", 26, 700)
text(755, 809, "합계 0.5 vCPU / 2 GiB · API + Gateway", 21, 600)
rect(760, 835, 480, 110, "#f5f9fd", "#b7c9db")
text(782, 870, "NestJS API  :3000", 23, 700)
text(782, 908, "단일 소유자 · HPA/다중 API 비활성화", 20)
rect(760, 1025, 480, 110, "#fff9f1", "#dfc39e")
text(782, 1060, "Caddy 입장 Gateway  :8080", 22, 700)
text(782, 1097, "초대·강퇴·중복 입장 권한 재검사", 20)
line([(991, 1025), (991, 945)])
tag(1010, 987, "localhost:3000", size=18)
text(775, 1000, "forward_auth", 18, 600, BLUE)
text(735, 1210, "공인 ENI · 수신: ALB 보안 그룹만 허용", 21, 600)
text(735, 1245, "외부 AWS API / 이미지 / 로그: IGW로 송신", 20, color=MUTED)
icon("igw", 1140, 1270, 42)
text(735, 1290, "NAT Gateway 없이 인터넷 송신", 20, 600, "#986010")

# 미디어 태스크는 전용 EC2 호스트 1대에서 실행하고 고정 공인 IP를 알립니다.
rect(1355, 710, 600, 460, "#ffffff", "#d17d20", 10, sw=2)
icon("ec2", 1375, 730, 56)
text(1448, 754, "LiveKit · ECS on EC2 ×1", 26, 700)
text(1377, 815, "c7i.xlarge · 4 vCPU / 8 GiB", 23, 600)
text(1377, 850, "ASG 고정 1대 · host network · task 1개/host", 20)
rect(1377, 865, 556, 68, "#edf8f3", "#c1ded0", 5)
text(1394, 891, "Static EIP → ICE 공개 주소", 22, 700, GREEN)
text(1394, 916, "직접 미디어: UDP 7882-7897 / TCP 7881", 20, 600, GREEN)
text(1377, 972, "내부 제어·신호  :7880  /  private IP", 22, 600)
text(1377, 1013, "TURN listener  :5349  /  NLB TLS 종료", 21, 600)
text(1377, 1054, "TURN relay UDP 30000-40000", 21, 600, ORANGE)
text(1377, 1094, "새 이미지 배포 전 수업 종료·drain 필요", 20, color=MUTED)
text(1377, 1134, "공인 ICE·릴레이 경로는 ALB를 우회", 20, color=MUTED)
text(1355, 1211, "미디어 노드·태스크 장애 시 수업 중단", 21, 600, "#986010")

card(2045, 710, 400, 170, "rds", "RDS PostgreSQL 16", ["db.t4g.small / 2 GiB / 20 GB", "Single-AZ ×1 · TLS 5432", "Aurora · RDS Proxy 없음"], row_size=18)
card(2045, 930, 400, 150, "redis", "Redis · LiveKit", ["cache.t4g.micro ×1 / 0.5 GiB", "TLS 6379 · replica/failover 없음"], row_size=18)
card(2045, 1140, 400, 150, "redis", "Redis · Application", ["cache.t4g.micro ×1 / 0.5 GiB", "TLS · 분산 앱 어댑터 준비용"], row_size=18)
text(2045, 1330, "DB·Redis는 인터넷 기본 경로 없음", 19, 600, "#665585")

# API와 인증된 신호 경로를 별도 연결선으로 표시합니다.
line([(1150, 390), (1150, 455), (300, 455), (300, 750), (390, 750)])
tag(827, 445, "② API / Socket.IO → origin. / HTTPS", size=19)
line([(125, 430), (125, 790), (390, 790)])
tag(210, 780, "③ rtc. WSS 443", size=18)
line([(650, 780), (695, 780), (695, 890), (760, 890)])
tag(675, 878, ":3000", size=17)
line([(650, 824), (680, 824), (680, 1080), (760, 1080)])
tag(673, 1067, ":8080", size=17)
line([(1240, 890), (1310, 890), (1310, 970), (1355, 970)])
tag(1267, 951, ":7880", size=17)
line([(1240, 1080), (1300, 1080), (1300, 1105), (1355, 1105)])
tag(1260, 1130, ":7880", size=17)

# API의 DB 통신은 미디어 영역 위쪽에, SFU의 Redis 통신은 오른쪽에 배치합니다.
line([(1240, 855), (1310, 855), (1310, 686), (2000, 686), (2000, 792), (2045, 792)])
tag(1616, 681, "API → DB / TLS 5432", size=18)
line([(1955, 1005), (2045, 1005)])
tag(1960, 991, "TLS", size=17)

# TURN과 직접 ICE 통신은 HTTP 경로를 거치지 않습니다.
line([(175, 430), (175, 1200), (390, 1200)], "orange", 3)
tag(210, 1190, "④ turn. TLS 443", ORANGE, 18)
line([(650, 1220), (690, 1220), (690, 1340), (1455, 1340), (1455, 1170)], "orange", 3)
tag(826, 1331, "TCP 5349 / PROXY v2", ORANGE, 19)
line([(75, 430), (75, 1440), (1825, 1440), (1825, 1170)], "green", 4)
tag(453, 1430, "⑤ DTLS-SRTP / 직접 ICE: UDP 7882-7897 · TCP 7881", GREEN, 22)
tag(1860, 1430, "CloudFront · ALB 우회", GREEN, 19)

# VPC 경계 밖에 있는 리전 관리형 서비스입니다.
text(340, 1490, "관리형 서비스 · 이미지·비밀·인증서·로그·파일", 22, 700, "#526b83")
for x, width, key, title, rows in (
    (340, 330, "ecs", "Amazon ECS", ["Fargate + EC2 capacity", "task role / 실행 역할"]),
    (700, 235, "ecr", "ECR", ["불변 이미지", "digest 고정"]),
    (965, 350, "secrets", "Secrets Manager", ["DB·Redis·LiveKit 비밀", "장기 AWS 키 없음"]),
    (1345, 330, "kms", "KMS + ACM", ["저장 암호화 / TLS 인증서", "edge + ALB + TURN NLB"]),
    (1705, 320, "cloudwatch", "CloudWatch", ["컨테이너·DB·Redis 로그", "보관 3일 / AMP 없음"]),
    (2055, 415, "s3", "Private S3 · 자료", ["API task role → S3", "KMS / 버전 관리 / 공개 차단"]),
):
    card(x, 1512, width, 155, key, title, rows, fill="#fafbfd", title_size=21, row_size=18)
icon("acm", 1615, 1530, 42)

# 범례와 실제 운영 제약입니다.
line([(42, 1774), (105, 1774)], "blue", 3)
text(123, 1782, "HTTPS · WSS · 내부 제어 / DB·Redis", 21, 600)
line([(650, 1774), (713, 1774)], "green", 4)
text(731, 1782, "영상·음성 직접 전송", 21, 600)
line([(1120, 1774), (1183, 1774)], "orange", 3)
text(1201, 1782, "TURN 우회", 21, 600)
text(1520, 1782, "실선 = 통신 / AZ는 논리 표기 / 축척 없음", 20, color=MUTED)
text(42, 1824, "검증 목표: 50명 이상 동시 접속. 실제 수용량은 구독 수·화질·화면 공유·강제 TURN 비율에 따라 부하 시험으로 확정합니다.", 22, 600)
text(42, 1860, "2026-11-10 · 공식 AWS 아키텍처 아이콘 · 리소스 적용 전 설계 · 단일 노드/태스크/DB/Redis로 무중단·장애 조치 보장 없음", 20, color=MUTED)
SVG.append('</svg>')
(HERE / "aws-ecs-test-architecture.svg").write_text('\n'.join(SVG))
if hasattr(ET, "indent"):
    ET.indent(mxfile, space="  ")
ET.ElementTree(mxfile).write(HERE / "aws-ecs-test-architecture.drawio", encoding="utf-8", xml_declaration=True)
print(f"Wrote ECS test SVG + diagrams.net source ({W} x {H})")
