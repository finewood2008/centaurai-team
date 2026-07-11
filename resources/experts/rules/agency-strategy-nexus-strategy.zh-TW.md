# 🌐 NEXUS — Network of EXperts, Unified in Strategy（專家網絡，統一於戰略）

## The Agency 多 agent 編排的完整運營 Playbook

> **NEXUS** 將 The Agency 中各自獨立的 AI 專家轉變為一個同步協作的智能網絡。這不是一份提示詞集合——它是一套**部署准則**，把 The Agency 轉變為任何項目、產品或組織的力量倍增器。

---

## 目錄

1. [戰略基礎](#1-戰略基礎)
2. [NEXUS 運營模型](#2-nexus-運營模型)
3. [第 0 階段 — 情報與發現](#3-第-0-階段--情報與發現)
4. [第 1 階段 — 戰略與架構](#4-第-1-階段--戰略與架構)
5. [第 2 階段 — 基礎與腳手架](#5-第-2-階段--基礎與腳手架)
6. [第 3 階段 — 構建與迭代](#6-第-3-階段--構建與迭代)
7. [第 4 階段 — 質量與加固](#7-第-4-階段--質量與加固)
8. [第 5 階段 — 上線與增長](#8-第-5-階段--上線與增長)
9. [第 6 階段 — 運營與演進](#9-第-6-階段--運營與演進)
10. [Agent 協調矩陣](#10-agent-協調矩陣)
11. [交接協議](#11-交接協議)
12. [質量關卡](#12-質量關卡)
13. [風險管理](#13-風險管理)
14. [成功指標](#14-成功指標)
15. [快速上手激活指南](#15-快速上手激活指南)

---

## 1. 戰略基礎

### 1.1 NEXUS 解決了甚麼

單個 agent 很強大。但在缺乏協調的情況下，它們會產生：

- 相互衝突的架構決策
- 跨部門的重復工作
- 交接邊界處的質量缺口
- 沒有共享的上下文或組織記憶

**NEXUS 消除了這些失敗模式**，方法是定義：

- 在每個階段**誰**被激活
- 他們產出**甚麼**、為誰產出
- 他們**何時**交接、交接給誰
- 在推進之前**如何**驗證質量
- 每個 agent **為何**存在於流水線中（沒有搭便車的人）

### 1.2 核心原則

| Principle                                     | Description                                 |
| --------------------------------------------- | ------------------------------------------- |
| **Pipeline Integrity（流水線完整性）**        | 不通過質量關卡，任何階段都不得推進          |
| **Context Continuity（上下文連續性）**        | 每次交接都攜帶完整上下文——沒有 agent 冷啓動 |
| **Parallel Execution（並行執行）**            | 獨立的工作流併發運行以壓縮時間線            |
| **Evidence Over Claims（證據優於斷言）**      | 所有質量評估都需要證據，而非斷言            |
| **Fail Fast, Fix Fast（快速失敗，快速修復）** | 每項任務最多重試 3 次後升級                 |
| **Single Source of Truth（單一事實來源）**    | 一份權威規格、一份任務清單、一份架構文檔    |

### 1.3 按部門劃分的 Agent 名冊

| Division               | Agents                                                                                                                                                                      | Primary NEXUS Role                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Engineering**        | Frontend Developer, Backend Architect, Mobile App Builder, AI Engineer, DevOps Automator, Rapid Prototyper, Senior Developer                                                | 構建、部署和維護所有技術系統       |
| **Design**             | UI Designer, UX Researcher, UX Architect, Brand Guardian, Visual Storyteller, Whimsy Injector, Image Prompt Engineer                                                        | 定義視覺標識、用戶體驗和品牌一致性 |
| **Marketing**          | Growth Hacker, Content Creator, Twitter Engager, TikTok Strategist, Instagram Curator, Reddit Community Builder, App Store Optimizer, Social Media Strategist               | 驅動獲客、互動和市場存在感         |
| **Product**            | Sprint Prioritizer, Trend Researcher, Feedback Synthesizer                                                                                                                  | 定義構建甚麼、何時構建以及為甚麼   |
| **Project Management** | Studio Producer, Project Shepherd, Studio Operations, Experiment Tracker, Senior Project Manager                                                                            | 編排時間線、資源和跨職能協調       |
| **Testing**            | Evidence Collector, Reality Checker, Test Results Analyzer, Performance Benchmarker, API Tester, Tool Evaluator, Workflow Optimizer                                         | 通過基於證據的評估來驗證質量       |
| **Support**            | Support Responder, Analytics Reporter, Finance Tracker, Infrastructure Maintainer, Legal Compliance Checker, Executive Summary Generator                                    | 維繫運營、合規和商業智能           |
| **Spatial Computing**  | XR Interface Architect, macOS Spatial/Metal Engineer, XR Immersive Developer, XR Cockpit Interaction Specialist, visionOS Spatial Engineer, Terminal Integration Specialist | 構建沈浸式和空間計算體驗           |
| **Specialized**        | Agents Orchestrator, Analytics Reporter, LSP/Index Engineer, Sales Data Extraction Agent, Data Consolidation Agent, Report Distribution Agent                               | 橫向協調、深度分析和代碼智能       |

---

## 2. NEXUS 運營模型

### 2.1 七階段流水線

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        NEXUS PIPELINE                                   │
│                                                                         │
│  Phase 0        Phase 1         Phase 2          Phase 3                │
│  DISCOVER  ───▶ STRATEGIZE ───▶ SCAFFOLD   ───▶  BUILD                 │
│  Intelligence   Architecture    Foundation       Dev ↔ QA Loop          │
│                                                                         │
│  Phase 4        Phase 5         Phase 6                                 │
│  HARDEN   ───▶  LAUNCH    ───▶  OPERATE                                │
│  Quality Gate   Go-to-Market    Sustained Ops                           │
│                                                                         │
│  ◆ Quality Gate between every phase                                     │
│  ◆ Parallel tracks within phases                                        │
│  ◆ Feedback loops at every boundary                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 指揮結構

```
                    ┌──────────────────────┐
                    │  Agents Orchestrator  │  ◄── Pipeline Controller
                    │  (Specialized)        │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────────┐
     │ Studio        │ │ Project      │ │ Senior Project   │
     │ Producer      │ │ Shepherd     │ │ Manager          │
     │ (Portfolio)   │ │ (Execution)  │ │ (Task Scoping)   │
     └───────────────┘ └──────────────┘ └─────────────────┘
              │                │                │
              ▼                ▼                ▼
     ┌─────────────────────────────────────────────────┐
     │           Division Leads (per phase)             │
     │  Engineering │ Design │ Marketing │ Product │ QA │
     └─────────────────────────────────────────────────┘
```

### 2.3 激活模式

NEXUS 支持三種部署配置：

| Mode             | Agents Active | Use Case                       | Timeline |
| ---------------- | ------------- | ------------------------------ | -------- |
| **NEXUS-Full**   | All           | 企業級產品發佈、完整生命週期   | 12-24 周 |
| **NEXUS-Sprint** | 15-25         | 功能開發、MVP 構建             | 2-6 周   |
| **NEXUS-Micro**  | 5-10          | Bug 修復、內容活動、單項交付物 | 1-5 天   |

---

## 3. 第 0 階段 — 情報與發現

> **目標**：在投入資源之前理解全局。在問題得到驗證之前不動工。

### 3.1 活躍的 Agent

| Agent                        | Role in Phase  | Primary Output                |
| ---------------------------- | -------------- | ----------------------------- |
| **Trend Researcher**         | 市場情報負責人 | 含 TAM/SAM/SOM 的市場分析報告 |
| **Feedback Synthesizer**     | 用戶需求分析   | 含痛點的綜合反饋報告          |
| **UX Researcher**            | 用戶行為分析   | 含用戶畫像和旅程圖的研究發現  |
| **Analytics Reporter**       | 數據現狀評估   | 含可用信號的數據審計報告      |
| **Legal Compliance Checker** | 監管掃描       | 合規要求矩陣                  |
| **Tool Evaluator**           | 技術格局       | 技術棧評估                    |

### 3.2 並行工作流

```
WORKSTREAM A: Market Intelligence          WORKSTREAM B: User Intelligence
├── Trend Researcher                       ├── Feedback Synthesizer
│   ├── Competitive landscape              │   ├── Multi-channel feedback collection
│   ├── Market sizing (TAM/SAM/SOM)        │   ├── Sentiment analysis
│   └── Trend lifecycle mapping            │   └── Pain point prioritization
│                                          │
├── Analytics Reporter                     ├── UX Researcher
│   ├── Existing data audit                │   ├── User interviews/surveys
│   ├── Signal identification              │   ├── Persona development
│   └── Baseline metrics                   │   └── Journey mapping
│                                          │
└── Legal Compliance Checker               └── Tool Evaluator
    ├── Regulatory requirements                ├── Technology assessment
    ├── Data handling constraints               ├── Build vs. buy analysis
    └── Jurisdiction mapping                   └── Integration feasibility
```

### 3.3 第 0 階段質量關卡

**關卡守門人**：Executive Summary Generator

| Criterion        | Threshold          | Evidence Required                         |
| ---------------- | ------------------ | ----------------------------------------- |
| 市場機會已驗證   | TAM > 最低可行門檻 | 含來源的 Trend Researcher 報告            |
| 用戶需求已確認   | ≥3 個經驗證的痛點  | Feedback Synthesizer + UX Researcher 數據 |
| 監管路徑清晰     | 無阻塞性合規問題   | Legal Compliance Checker 矩陣             |
| 數據基礎已評估   | 關鍵指標已識別     | Analytics Reporter 審計                   |
| 技術可行性已確認 | 技術棧已驗證       | Tool Evaluator 評估                       |

**產出**：高管摘要（≤500 字，SCQA 格式）→ 決策：GO / NO-GO / PIVOT

---

## 4. 第 1 階段 — 戰略與架構

> **目標**：在寫下一行代碼之前，定義我們要構建甚麼、它如何組織，以及成功是甚麼樣子。

### 4.1 活躍的 Agent

| Agent                      | Role in Phase        | Primary Output                  |
| -------------------------- | -------------------- | ------------------------------- |
| **Studio Producer**        | 戰略組合對齊         | 戰略組合計劃                    |
| **Senior Project Manager** | 規格轉任務           | 完整任務清單                    |
| **Sprint Prioritizer**     | 功能優先級排序       | 優先級排序後的待辦（RICE 評分） |
| **UX Architect**           | 技術架構 + UX 基礎   | 架構規格 + CSS 設計系統         |
| **Brand Guardian**         | 品牌標識系統         | 品牌基礎文檔                    |
| **Backend Architect**      | 系統架構             | 系統架構規格說明                |
| **AI Engineer**            | AI/ML 架構（如適用） | ML 系統設計                     |
| **Finance Tracker**        | 預算與資源規劃       | 含 ROI 預測的財務計劃           |

### 4.2 執行序列

```
STEP 1: Strategic Framing (Parallel)
├── Studio Producer → Strategic Portfolio Plan (vision, objectives, ROI targets)
├── Brand Guardian → Brand Foundation (purpose, values, visual identity system)
└── Finance Tracker → Budget Framework (resource allocation, cost projections)

STEP 2: Technical Architecture (Parallel, after Step 1)
├── UX Architect → CSS Design System + Layout Framework + UX Structure
├── Backend Architect → System Architecture (services, databases, APIs)
├── AI Engineer → ML Architecture (models, pipelines, inference strategy)
└── Senior Project Manager → Task List (spec → tasks, exact requirements)

STEP 3: Prioritization (Sequential, after Step 2)
└── Sprint Prioritizer → RICE-scored backlog with sprint assignments
    ├── Input: Task List + Architecture Spec + Budget Framework
    ├── Output: Prioritized sprint plan with dependency map
    └── Validation: Studio Producer confirms strategic alignment
```

### 4.3 第 1 階段質量關卡

**關卡守門人**：Studio Producer + Reality Checker（雙重簽字）

| Criterion           | Threshold                     | Evidence Required                     |
| ------------------- | ----------------------------- | ------------------------------------- |
| 架構覆蓋所有需求    | 100% 規格覆蓋                 | 交叉引用的 Senior PM 任務清單         |
| 品牌系統完整        | 已定義 Logo、配色、字體、語調 | Brand Guardian 交付物                 |
| 技術可行性已驗證    | 所有組件都有實現路徑          | Backend Architect + UX Architect 規格 |
| 預算已批准          | 在組織約束之內                | Finance Tracker 計劃                  |
| Sprint 計劃現實可行 | 基於速率的估算                | Sprint Prioritizer 待辦               |

**產出**：經批准的架構包 → 激活第 2 階段

---

## 5. 第 2 階段 — 基礎與腳手架

> **目標**：構建所有後續工作所依賴的技術與運營基礎。先把骨架立起來，再添肌肉。

### 5.1 活躍的 Agent

| Agent                         | Role in Phase           | Primary Output                 |
| ----------------------------- | ----------------------- | ------------------------------ |
| **DevOps Automator**          | CI/CD 流水線 + 基礎設施 | 部署流水線 + IaC 模板          |
| **Frontend Developer**        | 項目腳手架 + 組件庫     | 應用骨架 + 設計系統實現        |
| **Backend Architect**         | 數據庫 + API 基礎       | Schema + API 腳手架 + 鑒權系統 |
| **UX Architect**              | CSS 系統實現            | 設計令牌 + 佈局框架            |
| **Infrastructure Maintainer** | 雲基礎設施搭建          | 監控 + 日誌 + 告警             |
| **Studio Operations**         | 流程搭建                | 協作工具 + 工作流              |

### 5.2 並行工作流

```
WORKSTREAM A: Infrastructure              WORKSTREAM B: Application Foundation
├── DevOps Automator                      ├── Frontend Developer
│   ├── CI/CD pipeline (GitHub Actions)   │   ├── Project scaffolding
│   ├── Container orchestration           │   ├── Component library setup
│   └── Environment provisioning          │   └── Design system integration
│                                         │
├── Infrastructure Maintainer             ├── Backend Architect
│   ├── Cloud resource provisioning       │   ├── Database schema deployment
│   ├── Monitoring (Prometheus/Grafana)   │   ├── API scaffold + auth
│   └── Security hardening               │   └── Service communication layer
│                                         │
└── Studio Operations                     └── UX Architect
    ├── Git workflow + branch strategy        ├── CSS design tokens
    ├── Communication channels                ├── Responsive layout system
    └── Documentation templates               └── Theme system (light/dark/system)
```

### 5.3 第 2 階段質量關卡

**關卡守門人**：DevOps Automator + Evidence Collector

| Criterion            | Threshold              | Evidence Required       |
| -------------------- | ---------------------- | ----------------------- |
| CI/CD 流水線可運行   | 構建 + 測試 + 部署正常 | 流水線執行日誌          |
| 數據庫 schema 已部署 | 所有表/索引已創建      | 遷移成功 + schema dump  |
| API 腳手架有響應     | 健康檢查端點已上線     | curl 響應截圖           |
| 前端可渲染           | 骨架應用在瀏覽器中加載 | Evidence Collector 截圖 |
| 監控已激活           | 儀錶盤顯示指標         | Grafana/監控截圖        |
| 設計系統已實現       | 令牌 + 組件可用        | 組件庫演示              |

**產出**：帶完整 DevOps 流水線的可運行骨架應用 → 激活第 3 階段

---

## 6. 第 3 階段 — 構建與迭代

> **目標**：通過持續的 Dev↔QA 閉環實現功能。每項任務在下一項開始之前都得到驗證。這是大部分工作發生的地方。

### 6.1 Dev↔QA 閉環

這是 NEXUS 的核心。Agents Orchestrator 管理一個**逐任務的質量閉環**：

```
┌─────────────────────────────────────────────────────────┐
│                   DEV ↔ QA LOOP                          │
│                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │ Developer │───▶│ Evidence │───▶│ Decision Logic    │   │
│  │ Agent     │    │ Collector│    │                   │   │
│  │           │    │ (QA)     │    │ PASS → Next Task  │   │
│  │ Implements│    │          │    │ FAIL → Retry (≤3) │   │
│  │ Task N    │    │ Tests    │    │ BLOCKED → Escalate│   │
│  │           │◀───│ Task N   │◀───│                   │   │
│  └──────────┘    └──────────┘    └──────────────────┘   │
│       ▲                                    │             │
│       │            QA Feedback             │             │
│       └────────────────────────────────────┘             │
│                                                          │
│  Orchestrator tracks: attempt count, QA feedback,        │
│  task status, cumulative quality metrics                 │
└─────────────────────────────────────────────────────────┘
```

### 6.2 按任務類型分配 Agent

| Task Type         | Primary Developer                 | QA Agent                | Specialist Support           |
| ----------------- | --------------------------------- | ----------------------- | ---------------------------- |
| Frontend UI       | Frontend Developer                | Evidence Collector      | UI Designer, Whimsy Injector |
| Backend API       | Backend Architect                 | API Tester              | Performance Benchmarker      |
| Database          | Backend Architect                 | API Tester              | Analytics Reporter           |
| Mobile            | Mobile App Builder                | Evidence Collector      | UX Researcher                |
| AI/ML Feature     | AI Engineer                       | Test Results Analyzer   | Analytics Reporter           |
| Infrastructure    | DevOps Automator                  | Performance Benchmarker | Infrastructure Maintainer    |
| Premium Polish    | Senior Developer                  | Evidence Collector      | Visual Storyteller           |
| Rapid Prototype   | Rapid Prototyper                  | Evidence Collector      | Experiment Tracker           |
| Spatial/XR        | XR Immersive Developer            | Evidence Collector      | XR Interface Architect       |
| visionOS          | visionOS Spatial Engineer         | Evidence Collector      | macOS Spatial/Metal Engineer |
| Cockpit UI        | XR Cockpit Interaction Specialist | Evidence Collector      | XR Interface Architect       |
| CLI/Terminal      | Terminal Integration Specialist   | API Tester              | LSP/Index Engineer           |
| Code Intelligence | LSP/Index Engineer                | Test Results Analyzer   | Senior Developer             |

### 6.3 並行構建軌道

對於複雜項目，多條軌道同時運行：

```
TRACK A: Core Product                    TRACK B: Growth & Marketing
├── Frontend Developer                   ├── Growth Hacker
│   └── UI implementation                │   └── Viral loops + referral system
├── Backend Architect                    ├── Content Creator
│   └── API + business logic             │   └── Launch content + editorial calendar
├── AI Engineer                          ├── Social Media Strategist
│   └── ML features + pipelines          │   └── Cross-platform campaign
│                                        ├── App Store Optimizer (if mobile)
│                                        │   └── ASO strategy + metadata
│                                        │
TRACK C: Quality & Operations            TRACK D: Brand & Experience
├── Evidence Collector                   ├── UI Designer
│   └── Continuous QA screenshots        │   └── Component refinement
├── API Tester                           ├── Brand Guardian
│   └── Endpoint validation              │   └── Brand consistency audit
├── Performance Benchmarker              ├── Visual Storyteller
│   └── Load testing + optimization      │   └── Visual narrative assets
├── Workflow Optimizer                   └── Whimsy Injector
│   └── Process improvement                  └── Delight moments + micro-interactions
└── Experiment Tracker
    └── A/B test management
```

### 6.4 第 3 階段質量關卡

**關卡守門人**：Agents Orchestrator

| Criterion        | Threshold               | Evidence Required                  |
| ---------------- | ----------------------- | ---------------------------------- |
| 所有任務通過 QA  | 100% 任務完成           | 每項任務的 Evidence Collector 截圖 |
| API 端點已驗證   | 所有端點已測試          | API Tester 報告                    |
| 性能基線達標     | P95 < 200ms, LCP < 2.5s | Performance Benchmarker 報告       |
| 品牌一致性已核實 | 95%+ 遵從度             | Brand Guardian 審計                |
| 無關鍵 bug       | 零 P0/P1 未決問題       | Test Results Analyzer 摘要         |

**產出**：功能完整的應用 → 激活第 4 階段

---

## 7. 第 4 階段 — 質量與加固

> **目標**：最終的質量大考。Reality Checker 默認判定為"NEEDS WORK"——你必須以壓倒性的證據證明生產就緒。

### 7.1 活躍的 Agent

| Agent                         | Role in Phase                         | Primary Output     |
| ----------------------------- | ------------------------------------- | ------------------ |
| **Reality Checker**           | 最終集成測試（默認判定為 NEEDS WORK） | 基於現實的集成報告 |
| **Evidence Collector**        | 全面的視覺證據                        | 截圖證據包         |
| **Performance Benchmarker**   | 負載測試 + 優化                       | 性能認證           |
| **API Tester**                | 完整 API 回歸套件                     | API 測試報告       |
| **Test Results Analyzer**     | 匯總質量指標                          | 質量指標儀錶盤     |
| **Legal Compliance Checker**  | 最終合規審計                          | 合規認證           |
| **Infrastructure Maintainer** | 生產就緒檢查                          | 基礎設施就緒報告   |
| **Workflow Optimizer**        | 流程效率評審                          | 優化建議           |

### 7.2 加固序列

```
STEP 1: Evidence Collection (Parallel)
├── Evidence Collector → Full screenshot suite (desktop, tablet, mobile)
├── API Tester → Complete endpoint regression
├── Performance Benchmarker → Load test at 10x expected traffic
└── Legal Compliance Checker → Final regulatory audit

STEP 2: Analysis (Parallel, after Step 1)
├── Test Results Analyzer → Aggregate all test data into quality dashboard
├── Workflow Optimizer → Identify remaining process inefficiencies
└── Infrastructure Maintainer → Production environment validation

STEP 3: Final Judgment (Sequential, after Step 2)
└── Reality Checker → Integration Report
    ├── Cross-validates ALL previous QA findings
    ├── Tests complete user journeys with screenshot evidence
    ├── Verifies specification compliance point-by-point
    ├── Default verdict: NEEDS WORK
    └── READY only with overwhelming evidence across all criteria
```

### 7.3 第 4 階段質量關卡（最終關卡）

**關卡守門人**：Reality Checker（唯一權威）

| Criterion    | Threshold                         | Evidence Required             |
| ------------ | --------------------------------- | ----------------------------- |
| 用戶旅程完整 | 所有關鍵路徑正常                  | 端到端截圖                    |
| 跨設備一致性 | 桌面 + 平板 + 手機                | 響應式截圖                    |
| 性能已認證   | P95 < 200ms, 正常運行時間 > 99.9% | 負載測試結果                  |
| 安全已驗證   | 零關鍵漏洞                        | 安全掃描報告                  |
| 合規已認證   | 滿足所有監管要求                  | Legal Compliance Checker 報告 |
| 規格遵從     | 100% 的規格要求                   | 逐條核實                      |

**裁定選項**：

- **READY** —— 推進至上線（首輪即通過較為罕見）
- **NEEDS WORK** —— 帶具體修復清單返回第 3 階段（預期情況）
- **NOT READY** —— 重大架構問題，返回第 1/2 階段

**預期**：首次實現通常需要 2-3 輪修訂。B/B+ 評級是正常且健康的。

---

## 8. 第 5 階段 — 上線與增長

> **目標**：在所有渠道同時協調上市執行。在上線時實現最大影響。

### 8.1 活躍的 Agent

| Agent                           | Role in Phase          | Primary Output              |
| ------------------------------- | ---------------------- | --------------------------- |
| **Growth Hacker**               | 上線策略負責人         | 含病毒式循環的增長 Playbook |
| **Content Creator**             | 上線內容               | 博文、視頻、社交內容        |
| **Social Media Strategist**     | 跨平台營銷活動         | 營銷日曆 + 內容             |
| **Twitter Engager**             | Twitter/X 上線活動     | Thread 策略 + 互動計劃      |
| **TikTok Strategist**           | TikTok 病毒式內容      | 短視頻策略                  |
| **Instagram Curator**           | 視覺上線活動           | 視覺內容 + stories          |
| **Reddit Community Builder**    | 真實的社區上線         | 社區互動計劃                |
| **App Store Optimizer**         | 商店優化（如為移動端） | ASO 包                      |
| **Executive Summary Generator** | 利益相關方溝通         | 上線高管摘要                |
| **Project Shepherd**            | 上線協調               | 上線清單 + 時間線           |
| **DevOps Automator**            | 部署執行               | 零停機部署                  |
| **Infrastructure Maintainer**   | 上線監控               | 實時儀錶盤                  |

### 8.2 上線序列

```
T-7 DAYS: Pre-Launch
├── Content Creator → Launch content queued and scheduled
├── Social Media Strategist → Campaign assets finalized
├── Growth Hacker → Viral mechanics tested and armed
├── App Store Optimizer → Store listing optimized
├── DevOps Automator → Blue-green deployment prepared
└── Infrastructure Maintainer → Auto-scaling configured for 10x

T-0: Launch Day
├── DevOps Automator → Execute deployment
├── Infrastructure Maintainer → Monitor all systems
├── Twitter Engager → Launch thread + real-time engagement
├── Reddit Community Builder → Authentic community posts
├── Instagram Curator → Visual launch content
├── TikTok Strategist → Launch videos published
├── Support Responder → Customer support active
└── Analytics Reporter → Real-time metrics dashboard

T+1 TO T+7: Post-Launch
├── Growth Hacker → Analyze acquisition data, optimize funnels
├── Feedback Synthesizer → Collect and analyze early user feedback
├── Analytics Reporter → Daily metrics reports
├── Content Creator → Response content based on reception
├── Experiment Tracker → Launch A/B tests
└── Executive Summary Generator → Daily stakeholder briefings
```

### 8.3 第 5 階段質量關卡

**關卡守門人**：Studio Producer + Analytics Reporter

| Criterion        | Threshold                | Evidence Required                |
| ---------------- | ------------------------ | -------------------------------- |
| 部署成功         | 零停機，所有健康檢查通過 | DevOps 部署日誌                  |
| 系統穩定         | 前 48 小時無 P0/P1 事件  | 基礎設施監控                     |
| 用戶獲取活躍     | 渠道正在引流             | Analytics Reporter 儀錶盤        |
| 反饋閉環運轉     | 正在收集用戶反饋         | Feedback Synthesizer 報告        |
| 利益相關方已知會 | 高管摘要已交付           | Executive Summary Generator 產出 |

**產出**：帶活躍增長渠道的穩定上線產品 → 激活第 6 階段

---

## 9. 第 6 階段 — 運營與演進

> **目標**：持續運營，伴隨不斷改進。產品已上線——現在讓它茁壯成長。

### 9.1 活躍的 Agent（持續進行）

| Agent                           | Cadence     | Responsibility                 |
| ------------------------------- | ----------- | ------------------------------ |
| **Infrastructure Maintainer**   | 持續        | 系統可靠性、正常運行時間、性能 |
| **Support Responder**           | 持續        | 客戶支持與問題解決             |
| **Analytics Reporter**          | 每周        | KPI 追蹤、儀錶盤、洞察         |
| **Feedback Synthesizer**        | 每兩周      | 用戶反饋分析與綜合             |
| **Finance Tracker**             | 每月        | 財務表現、預算追蹤             |
| **Legal Compliance Checker**    | 每月        | 監管監測與合規                 |
| **Trend Researcher**            | 每月        | 市場情報與競爭分析             |
| **Executive Summary Generator** | 每月        | 高管層彙報                     |
| **Sprint Prioritizer**          | 每個 sprint | 待辦梳理與 sprint 規劃         |
| **Experiment Tracker**          | 每個實驗    | A/B 測試管理與分析             |
| **Growth Hacker**               | 持續進行    | 獲客優化與增長實驗             |
| **Workflow Optimizer**          | 每季度      | 流程改進與效率提升             |

### 9.2 持續改進循環

```
┌──────────────────────────────────────────────────────────┐
│              CONTINUOUS IMPROVEMENT LOOP                   │
│                                                           │
│  MEASURE          ANALYZE           PLAN          ACT     │
│  ┌─────────┐     ┌──────────┐     ┌─────────┐   ┌─────┐ │
│  │Analytics │────▶│Feedback  │────▶│Sprint   │──▶│Build│ │
│  │Reporter  │     │Synthesizer│    │Prioritizer│  │Loop │ │
│  └─────────┘     └──────────┘     └─────────┘   └─────┘ │
│       ▲                                            │      │
│       │              Experiment                    │      │
│       │              Tracker                       │      │
│       └────────────────────────────────────────────┘      │
│                                                           │
│  Monthly: Executive Summary Generator → C-suite report    │
│  Monthly: Finance Tracker → Financial performance         │
│  Monthly: Legal Compliance Checker → Regulatory update    │
│  Monthly: Trend Researcher → Market intelligence          │
│  Quarterly: Workflow Optimizer → Process improvements     │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Agent 協調矩陣

### 10.1 完整的跨部門依賴圖

此矩陣展示了哪些 agent 產出的成果被其他 agent 消費。讀法為：**行 agent 產出 → 列 agent 消費**。

```
PRODUCER →          │ ENG │ DES │ MKT │ PRD │ PM  │ TST │ SUP │ SPC │ SPZ
────────────────────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼────
Engineering         │  ●  │     │     │     │     │  ●  │  ●  │  ●  │
Design              │  ●  │  ●  │  ●  │     │     │  ●  │     │  ●  │
Marketing           │     │     │  ●  │  ●  │     │     │  ●  │     │
Product             │  ●  │  ●  │  ●  │  ●  │  ●  │     │     │     │  ●
Project Management  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●
Testing             │  ●  │  ●  │     │  ●  │  ●  │  ●  │     │  ●  │
Support             │  ●  │     │  ●  │  ●  │  ●  │     │  ●  │     │  ●
Spatial Computing   │  ●  │  ●  │     │     │     │  ●  │     │  ●  │
Specialized         │  ●  │     │     │  ●  │  ●  │  ●  │  ●  │     │  ●

● = Active dependency (producer creates artifacts consumed by this division)
```

### 10.2 關鍵交接對

這些是 NEXUS 中流量最高的交接關係：

| From                        | To                     | Artifact                         | Frequency   |
| --------------------------- | ---------------------- | -------------------------------- | ----------- |
| Senior Project Manager      | All Developers         | Task List                        | 每個 sprint |
| UX Architect                | Frontend Developer     | CSS Design System + Layout Spec  | 每個項目    |
| Backend Architect           | Frontend Developer     | API Specification                | 每個功能    |
| Frontend Developer          | Evidence Collector     | Implemented Feature              | 每項任務    |
| Evidence Collector          | Agents Orchestrator    | QA Verdict (PASS/FAIL)           | 每項任務    |
| Agents Orchestrator         | Developer (any)        | QA Feedback + Retry Instructions | 每次失敗    |
| Brand Guardian              | All Design + Marketing | Brand Guidelines                 | 每個項目    |
| Analytics Reporter          | Sprint Prioritizer     | Performance Data                 | 每個 sprint |
| Feedback Synthesizer        | Sprint Prioritizer     | User Insights                    | 每個 sprint |
| Trend Researcher            | Studio Producer        | Market Intelligence              | 每月        |
| Reality Checker             | Agents Orchestrator    | Integration Verdict              | 每個階段    |
| Executive Summary Generator | Studio Producer        | Executive Brief                  | 每個里程碑  |

---

## 11. 交接協議

### 11.1 標準交接模板

每一次 agent 到 agent 的交接都必須包含：

```markdown
## NEXUS Handoff Document

### Metadata

- **From**: [Agent Name] ([Division])
- **To**: [Agent Name] ([Division])
- **Phase**: [Current NEXUS Phase]
- **Task Reference**: [Task ID from Sprint Prioritizer backlog]
- **Priority**: [Critical / High / Medium / Low]
- **Timestamp**: [ISO 8601]

### Context

- **Project**: [Project name and brief description]
- **Current State**: [What has been completed so far]
- **Relevant Files**: [List of files/artifacts to review]
- **Dependencies**: [What this work depends on]

### Deliverable Request

- **What is needed**: [Specific, measurable deliverable]
- **Acceptance criteria**: [How success will be measured]
- **Constraints**: [Technical, timeline, or resource constraints]
- **Reference materials**: [Links to specs, designs, previous work]

### Quality Expectations

- **Must pass**: [Specific quality criteria]
- **Evidence required**: [What proof of completion looks like]
- **Handoff to next**: [Who receives the output and what they need]
```

### 11.2 QA 反饋閉環協議

當一項任務未通過 QA 時，反饋必須是可操作的：

```markdown
## QA Failure Feedback

### Task: [Task ID and description]

### Attempt: [1/2/3] of 3 maximum

### Verdict: FAIL

### Specific Issues Found

1. **[Issue Category]**: [Exact description with screenshot reference]
   - Expected: [What should happen]
   - Actual: [What actually happens]
   - Evidence: [Screenshot filename or test output]

2. **[Issue Category]**: [Exact description]
   - Expected: [...]
   - Actual: [...]
   - Evidence: [...]

### Fix Instructions

- [Specific, actionable fix instruction 1]
- [Specific, actionable fix instruction 2]

### Files to Modify

- [file path 1]: [what needs to change]
- [file path 2]: [what needs to change]

### Retry Expectations

- Fix the above issues and re-submit for QA
- Do NOT introduce new features — fix only
- Attempt [N+1] of 3 maximum
```

### 11.3 升級協議

當一項任務超過 3 次重試嘗試時：

```markdown
## Escalation Report

### Task: [Task ID]

### Attempts Exhausted: 3/3

### Escalation Level: [To Agents Orchestrator / To Studio Producer]

### Failure History

- Attempt 1: [Summary of issues and fixes attempted]
- Attempt 2: [Summary of issues and fixes attempted]
- Attempt 3: [Summary of issues and fixes attempted]

### Root Cause Analysis

- [Why the task keeps failing]
- [What systemic issue is preventing resolution]

### Recommended Resolution

- [ ] Reassign to different developer agent
- [ ] Decompose task into smaller sub-tasks
- [ ] Revise architecture/approach
- [ ] Accept current state with known limitations
- [ ] Defer to future sprint

### Impact Assessment

- **Blocking**: [What other tasks are blocked by this]
- **Timeline Impact**: [How this affects the overall schedule]
- **Quality Impact**: [What quality compromises exist]
```

---

## 12. 質量關卡

### 12.1 關卡總覽

| Phase | Gate Name         | Gate Keeper                           | Pass Criteria                                         |
| ----- | ----------------- | ------------------------------------- | ----------------------------------------------------- |
| 0 → 1 | Discovery Gate    | Executive Summary Generator           | 市場已驗證、用戶需求已確認、監管路徑清晰              |
| 1 → 2 | Architecture Gate | Studio Producer + Reality Checker     | 架構完整、品牌已定義、預算已批准、sprint 計劃現實可行 |
| 2 → 3 | Foundation Gate   | DevOps Automator + Evidence Collector | CI/CD 正常、骨架應用運行、監控激活                    |
| 3 → 4 | Feature Gate      | Agents Orchestrator                   | 所有任務通過 QA、無關鍵 bug、性能基線達標             |
| 4 → 5 | Production Gate   | Reality Checker（唯一權威）           | 用戶旅程完整、跨設備一致、安全已驗證、規格遵從        |
| 5 → 6 | Launch Gate       | Studio Producer + Analytics Reporter  | 部署成功、系統穩定、增長渠道活躍                      |

### 12.2 關卡失敗處理

```
IF gate FAILS:
  ├── Gate Keeper produces specific failure report
  ├── Agents Orchestrator routes failures to responsible agents
  ├── Failed items enter Dev↔QA loop (Phase 3 mechanics)
  ├── Maximum 3 gate re-attempts before escalation to Studio Producer
  └── Studio Producer decides: fix, descope, or accept with risk
```

---

## 13. 風險管理

### 13.1 風險類別與負責人

| Risk Category             | Primary Owner            | Mitigation Agent          | Escalation Path     |
| ------------------------- | ------------------------ | ------------------------- | ------------------- |
| Technical Debt            | Backend Architect        | Workflow Optimizer        | Senior Developer    |
| Security Vulnerability    | Legal Compliance Checker | Infrastructure Maintainer | DevOps Automator    |
| Performance Degradation   | Performance Benchmarker  | Infrastructure Maintainer | Backend Architect   |
| Brand Inconsistency       | Brand Guardian           | UI Designer               | Studio Producer     |
| Scope Creep               | Senior Project Manager   | Sprint Prioritizer        | Project Shepherd    |
| Budget Overrun            | Finance Tracker          | Studio Operations         | Studio Producer     |
| Regulatory Non-Compliance | Legal Compliance Checker | Support Responder         | Studio Producer     |
| Market Shift              | Trend Researcher         | Growth Hacker             | Studio Producer     |
| Team Bottleneck           | Project Shepherd         | Studio Operations         | Studio Producer     |
| Quality Regression        | Reality Checker          | Evidence Collector        | Agents Orchestrator |

### 13.2 風險響應矩陣

| Severity          | Response Time | Decision Authority  | Action                 |
| ----------------- | ------------- | ------------------- | ---------------------- |
| **Critical** (P0) | 立即          | Studio Producer     | 全員出動，暫停其他工作 |
| **High** (P1)     | < 4 小時      | Project Shepherd    | 專人 agent 分配        |
| **Medium** (P2)   | < 24 小時     | Agents Orchestrator | 下個 sprint 優先級     |
| **Low** (P3)      | < 1 周        | Sprint Prioritizer  | 待辦項                 |

---

## 14. 成功指標

### 14.1 流水線指標

| Metric               | Target                   | Measurement Agent   |
| -------------------- | ------------------------ | ------------------- |
| 階段完成率           | 首次嘗試 95%             | Agents Orchestrator |
| 任務首次通過 QA 率   | 70%+                     | Evidence Collector  |
| 每項任務平均重試次數 | < 1.5                    | Agents Orchestrator |
| 流水線週期時間       | 在 sprint 估算 ±15% 之內 | Project Shepherd    |
| 質量關卡通過率       | 首次嘗試 80%+            | Reality Checker     |

### 14.2 產品指標

| Metric             | Target                  | Measurement Agent         |
| ------------------ | ----------------------- | ------------------------- |
| API 響應時間 (P95) | < 200ms                 | Performance Benchmarker   |
| 頁面加載時間 (LCP) | < 2.5s                  | Performance Benchmarker   |
| 系統正常運行時間   | > 99.9%                 | Infrastructure Maintainer |
| Lighthouse 評分    | > 90（性能 + 可訪問性） | Frontend Developer        |
| 安全漏洞           | 零關鍵                  | Legal Compliance Checker  |
| 規格遵從           | 100%                    | Reality Checker           |

### 14.3 業務指標

| Metric                 | Target    | Measurement Agent    |
| ---------------------- | --------- | -------------------- |
| 用戶獲取（環比 MoM）   | 20%+ 增長 | Growth Hacker        |
| 激活率                 | 首周 60%+ | Analytics Reporter   |
| 留存（Day 7 / Day 30） | 40% / 20% | Analytics Reporter   |
| LTV:CAC 比率           | > 3:1     | Finance Tracker      |
| NPS 得分               | > 50      | Feedback Synthesizer |
| 組合 ROI               | > 25%     | Studio Producer      |

### 14.4 運營指標

| Metric           | Target      | Measurement Agent           |
| ---------------- | ----------- | --------------------------- |
| 部署頻率         | 每天多次    | DevOps Automator            |
| 平均恢復時間     | < 30 分鐘   | Infrastructure Maintainer   |
| 合規遵從度       | 98%+        | Legal Compliance Checker    |
| 利益相關方滿意度 | 4.5/5       | Executive Summary Generator |
| 流程效率提升     | 每季度 20%+ | Workflow Optimizer          |

---

## 15. 快速上手激活指南

### 15.1 NEXUS-Full 激活（企業級）

```bash
# Step 1: Initialize NEXUS pipeline
"Activate Agents Orchestrator in NEXUS-Full mode for [PROJECT NAME].
 Project specification: [path to spec file].
 Execute complete 7-phase pipeline with all quality gates."

# The Orchestrator will:
# 1. Read the project specification
# 2. Activate Phase 0 agents for discovery
# 3. Progress through all phases with quality gates
# 4. Manage Dev↔QA loops automatically
# 5. Report status at each phase boundary
```

### 15.2 NEXUS-Sprint 激活（功能/MVP）

```bash
# Step 1: Initialize sprint pipeline
"Activate Agents Orchestrator in NEXUS-Sprint mode for [FEATURE/MVP NAME].
 Requirements: [brief description or path to spec].
 Skip Phase 0 (market already validated).
 Begin at Phase 1 with architecture and sprint planning."

# Recommended agent subset (15-25):
# PM: Senior Project Manager, Sprint Prioritizer, Project Shepherd
# Design: UX Architect, UI Designer, Brand Guardian
# Engineering: Frontend Developer, Backend Architect, DevOps Automator
# + AI Engineer or Mobile App Builder (if applicable)
# Testing: Evidence Collector, Reality Checker, API Tester, Performance Benchmarker
# Support: Analytics Reporter, Infrastructure Maintainer
# Specialized: Agents Orchestrator
```

### 15.3 NEXUS-Micro 激活（定向任務）

```bash
# Step 1: Direct agent activation
"Activate [SPECIFIC AGENT] for [TASK DESCRIPTION].
 Context: [relevant background].
 Deliverable: [specific output expected].
 Quality check: Evidence Collector to verify upon completion."

# Common NEXUS-Micro configurations:
#
# Bug Fix:
#   Backend Architect → API Tester → Evidence Collector
#
# Content Campaign:
#   Content Creator → Social Media Strategist → Twitter Engager
#   + Instagram Curator + Reddit Community Builder
#
# Performance Issue:
#   Performance Benchmarker → Infrastructure Maintainer → DevOps Automator
#
# Compliance Audit:
#   Legal Compliance Checker → Executive Summary Generator
#
# Market Research:
#   Trend Researcher → Analytics Reporter → Executive Summary Generator
#
# UX Improvement:
#   UX Researcher → UX Architect → Frontend Developer → Evidence Collector
```

### 15.4 Agent 激活提示詞模板

#### 給 Orchestrator（流水線啓動）

```
You are the Agents Orchestrator running NEXUS pipeline for [PROJECT].

Project spec: [path]
Mode: [Full/Sprint/Micro]
Current phase: [Phase N]

Execute the NEXUS protocol:
1. Read the project specification
2. Activate Phase [N] agents per the NEXUS strategy
3. Manage handoffs using the NEXUS Handoff Template
4. Enforce quality gates before phase advancement
5. Track all tasks with status reporting
6. Run Dev↔QA loops for all implementation tasks
7. Escalate after 3 failed attempts per task

Report format: NEXUS Pipeline Status Report (see template in strategy doc)
```

#### 給開髮型 Agent（任務實現）

```
You are [AGENT NAME] working within the NEXUS pipeline.

Phase: [Current Phase]
Task: [Task ID and description from Sprint Prioritizer backlog]
Architecture reference: [path to architecture doc]
Design system: [path to CSS/design tokens]
Brand guidelines: [path to brand doc]

Implement this task following:
1. The architecture specification exactly
2. The design system tokens and patterns
3. The brand guidelines for visual consistency
4. Accessibility standards (WCAG 2.1 AA)

When complete, your work will be reviewed by Evidence Collector.
Acceptance criteria: [specific criteria from task list]
```

#### 給 QA 型 Agent（任務驗證）

```
You are [QA AGENT] validating work within the NEXUS pipeline.

Phase: [Current Phase]
Task: [Task ID and description]
Developer: [Which agent implemented this]
Attempt: [N] of 3 maximum

Validate against:
1. Task acceptance criteria: [specific criteria]
2. Architecture specification: [path]
3. Brand guidelines: [path]
4. Performance requirements: [specific thresholds]

Provide verdict: PASS or FAIL
If FAIL: Include specific issues, evidence, and fix instructions
Use the NEXUS QA Feedback Loop Protocol format
```

---

## 附錄 A：部門速查

### Engineering Division — "Build It Right"（把它做對）

| Agent              | Superpower                                   | Activation Trigger    |
| ------------------ | -------------------------------------------- | --------------------- |
| Frontend Developer | React/Vue/Angular、Core Web Vitals、可訪問性 | 任何 UI 實現任務      |
| Backend Architect  | 可擴展系統、數據庫設計、API 架構             | 服務端架構或 API 工作 |
| Mobile App Builder | iOS/Android、React Native、Flutter           | 移動應用開發          |
| AI Engineer        | ML 模型、LLM、RAG 系統、數據管道             | 任何 AI/ML 功能       |
| DevOps Automator   | CI/CD、IaC、Kubernetes、監控                 | 基礎設施或部署工作    |
| Rapid Prototyper   | Next.js、Supabase、3 天 MVP                  | 快速驗證或概念驗證    |
| Senior Developer   | Laravel/Livewire、高端實現                   | 複雜或高端功能工作    |

### Design Division — "Make It Beautiful"（把它做美）

| Agent                 | Superpower                   | Activation Trigger       |
| --------------------- | ---------------------------- | ------------------------ |
| UI Designer           | 視覺設計系統、組件庫         | 界面設計或組件創建       |
| UX Researcher         | 用戶測試、行為分析、用戶畫像 | 用戶研究或可用性測試     |
| UX Architect          | CSS 系統、佈局框架、技術 UX  | 技術基礎或架構           |
| Brand Guardian        | 品牌標識、一致性、定位       | 品牌戰略或一致性審計     |
| Visual Storyteller    | 視覺敘事、多媒體內容         | 視覺內容或敘事需求       |
| Whimsy Injector       | 微交互、愉悅感、個性         | 為 UX 增添樂趣與個性     |
| Image Prompt Engineer | AI 圖像生成提示詞、攝影      | 為 AI 工具創建攝影提示詞 |

### Marketing Division — "Grow It Fast"（讓它快速增長）

| Agent                    | Superpower                 | Activation Trigger |
| ------------------------ | -------------------------- | ------------------ |
| Growth Hacker            | 病毒式循環、漏斗優化、實驗 | 用戶獲取或增長戰略 |
| Content Creator          | 多平台內容、編輯日曆       | 內容戰略或創作     |
| Twitter Engager          | 實時互動、思想領導力       | Twitter/X 營銷活動 |
| TikTok Strategist        | 病毒式短視頻、算法優化     | TikTok 增長戰略    |
| Instagram Curator        | 視覺敘事、美學塑造         | Instagram 營銷活動 |
| Reddit Community Builder | 真實互動、價值驅動內容     | Reddit 社區戰略    |
| App Store Optimizer      | ASO、轉化優化              | 移動應用商店存在感 |
| Social Media Strategist  | 跨平台戰略、營銷活動       | 多平台社交活動     |

### Product Division — "Build the Right Thing"（構建正確的東西）

| Agent                | Superpower                | Activation Trigger    |
| -------------------- | ------------------------- | --------------------- |
| Sprint Prioritizer   | RICE 評分、敏捷規劃、速率 | sprint 規劃或待辦梳理 |
| Trend Researcher     | 市場情報、競爭分析        | 市場研究或機會評估    |
| Feedback Synthesizer | 用戶反饋分析、情感分析    | 用戶反饋處理          |

### Project Management Division — "Keep It on Track"（保持正軌）

| Agent                  | Superpower                 | Activation Trigger |
| ---------------------- | -------------------------- | ------------------ |
| Studio Producer        | 組合戰略、高管編排         | 戰略規劃或組合管理 |
| Project Shepherd       | 跨職能協調、利益相關方對齊 | 複雜項目協調       |
| Studio Operations      | 日常效率、流程優化         | 運營支持           |
| Experiment Tracker     | A/B 測試、假設驗證         | 實驗管理           |
| Senior Project Manager | 規格轉任務、現實的範圍界定 | 任務規劃或範圍管理 |

### Testing Division — "Prove It Works"（證明它可用）

| Agent                   | Superpower                 | Activation Trigger |
| ----------------------- | -------------------------- | ------------------ |
| Evidence Collector      | 基於截圖的 QA、視覺證據    | 任何視覺核實需求   |
| Reality Checker         | 基於證據的認證、懷疑式評估 | 最終集成測試       |
| Test Results Analyzer   | 測試評估、質量指標         | 測試輸出分析       |
| Performance Benchmarker | 負載測試、性能優化         | 性能測試           |
| API Tester              | API 驗證、集成測試         | API 端點測試       |
| Tool Evaluator          | 技術評估、工具選型         | 技術評估           |
| Workflow Optimizer      | 流程分析、效率改進         | 流程優化           |

### Support Division — "Sustain It"（維繫它）

| Agent                       | Superpower                 | Activation Trigger |
| --------------------------- | -------------------------- | ------------------ |
| Support Responder           | 客戶服務、問題解決         | 客戶支持需求       |
| Analytics Reporter          | 數據分析、儀錶盤、KPI 追蹤 | 商業智能或報告     |
| Finance Tracker             | 財務規劃、預算管理         | 財務分析或預算     |
| Infrastructure Maintainer   | 系統可靠性、性能優化       | 基礎設施管理       |
| Legal Compliance Checker    | 合規、法規、法務審查       | 法務或合規需求     |
| Executive Summary Generator | 高管層溝通、SCQA 框架      | 高管層報告         |

### Spatial Computing Division — "Immerse Them"（讓他們沈浸）

| Agent                             | Superpower              | Activation Trigger |
| --------------------------------- | ----------------------- | ------------------ |
| XR Interface Architect            | 空間交互設計            | AR/VR/XR 界面設計  |
| macOS Spatial/Metal Engineer      | Swift、Metal、高性能 3D | macOS 空間計算     |
| XR Immersive Developer            | WebXR、瀏覽器端 AR/VR   | 瀏覽器端沈浸式體驗 |
| XR Cockpit Interaction Specialist | 座艙式控制              | 沈浸式控制界面     |
| visionOS Spatial Engineer         | Apple Vision Pro 開發   | Vision Pro 應用    |
| Terminal Integration Specialist   | CLI 工具、終端工作流    | 開發者工具集成     |

### Specialized Division — "Connect Everything"（連接一切）

| Agent                       | Superpower               | Activation Trigger  |
| --------------------------- | ------------------------ | ------------------- |
| Agents Orchestrator         | 多 agent 流水線管理      | 任何多 agent 工作流 |
| Analytics Reporter          | 商業智能、深度分析       | 深度數據分析        |
| LSP/Index Engineer          | 語言服務器協議、代碼智能 | 代碼智能系統        |
| Sales Data Extraction Agent | Excel 監控、銷售指標提取 | 銷售數據攝取        |
| Data Consolidation Agent    | 銷售數據聚合、儀錶盤報告 | 區域和銷售代表報告  |
| Report Distribution Agent   | 自動化報告分發           | 定時報告分發        |

---

## 附錄 B：NEXUS 流水線狀態報告模板

```markdown
# NEXUS Pipeline Status Report

## Pipeline Metadata

- **Project**: [Name]
- **Mode**: [Full / Sprint / Micro]
- **Current Phase**: [0-6]
- **Started**: [Timestamp]
- **Estimated Completion**: [Timestamp]

## Phase Progress

| Phase          | Status         | Completion | Gate Result |
| -------------- | -------------- | ---------- | ----------- |
| 0 - Discovery  | ✅ Complete    | 100%       | PASSED      |
| 1 - Strategy   | ✅ Complete    | 100%       | PASSED      |
| 2 - Foundation | 🔄 In Progress | 75%        | PENDING     |
| 3 - Build      | ⏳ Pending     | 0%         | —           |
| 4 - Harden     | ⏳ Pending     | 0%         | —           |
| 5 - Launch     | ⏳ Pending     | 0%         | —           |
| 6 - Operate    | ⏳ Pending     | 0%         | —           |

## Current Phase Detail

**Phase**: [N] - [Name]
**Active Agents**: [List]
**Tasks**: [Completed/Total]
**Current Task**: [ID] - [Description]
**QA Status**: [PASS/FAIL/IN_PROGRESS]
**Retry Count**: [N/3]

## Quality Metrics

- Tasks passed first attempt: [X/Y] ([Z]%)
- Average retries per task: [N]
- Critical issues found: [Count]
- Critical issues resolved: [Count]

## Risk Register

| Risk          | Severity | Status                    | Owner   |
| ------------- | -------- | ------------------------- | ------- |
| [Description] | [P0-P3]  | [Active/Mitigated/Closed] | [Agent] |

## Next Actions

1. [Immediate next step]
2. [Following step]
3. [Upcoming milestone]

---

**Report Generated**: [Timestamp]
**Orchestrator**: Agents Orchestrator
**Pipeline Health**: [ON_TRACK / AT_RISK / BLOCKED]
```

---

## 附錄 C：NEXUS 術語表

| Term                     | Definition                                                      |
| ------------------------ | --------------------------------------------------------------- |
| **NEXUS**                | Network of EXperts, Unified in Strategy（專家網絡，統一於戰略） |
| **Quality Gate**         | 階段之間的強制檢查點，需要基於證據的批准                        |
| **Dev↔QA Loop**          | 持續的開發-測試循環，每項任務必須通過 QA 才能繼續               |
| **Handoff**              | agent 之間工作與上下文的結構化傳遞                              |
| **Gate Keeper**          | 有權批准或拒絕階段推進的 agent                                  |
| **Escalation**           | 在重試耗盡後將受阻任務路由至更高權威                            |
| **NEXUS-Full**           | 啓用全部 agent 的完整流水線激活                                 |
| **NEXUS-Sprint**         | 用於功能/MVP 工作的 15-25 個 agent 的聚焦流水線                 |
| **NEXUS-Micro**          | 用於特定任務的 5-10 個 agent 的定向激活                         |
| **Pipeline Integrity**   | 不通過質量關卡任何階段都不得推進的原則                          |
| **Context Continuity**   | 每次交接都攜帶完整上下文的原則                                  |
| **Evidence Over Claims** | 質量評估需要證據而非斷言的原則                                  |

---

<div align="center">

**🌐 NEXUS：9 個部門。7 個階段。一個統一的戰略。🌐**

_從發現到持續運營——每個 agent 都清楚自己的角色、時機和交接。_

</div>
