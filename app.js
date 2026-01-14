// Logic chính: nhập đồ thị, giải Người đưa thư (Chinese Postman) và mô phỏng

const state = {
  nodes: new Set(),
  edges: [], // {id, from, to, length}
  duplicatedEdges: [], // extra edges for Chinese Postman
  route: [], // sequence of edge references {edge, isDuplicate}
  routeLengthOriginal: 0,
  routeLengthOptimized: 0,
  isConnected: false,
  eulerType: "unknown", // "unknown" | "eulerian" | "semi" | "none"
  oddNodes: [],
  // simulation
  simIndex: 0,
  simProgress: 0,
  simRunning: false,
  simSpeed: 1,
  sweeperPos: null, // {x, y}
  drawMode: false,
  drawNodes: new Map(), // nodeId -> {x,y}
  draggingFrom: null,
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  Object.assign(elements, {
    // no single-edge form anymore
    edgeTableBody: $("edge-table-body"),
    bulkEdges: $("bulk-edges"),
    bulkAddBtn: $("bulk-add-btn"),
    drawModeBtn: $("draw-mode-btn"),
    loadSample: $("load-sample"),
    clearGraph: $("clear-graph"),
    startNode: $("start-node"),
    returnStart: $("return-start"),
    analyzeBtn: $("analyze-btn"),
    computeRouteBtn: $("compute-route-btn"),
    playBtn: $("play-btn"),
    pauseBtn: $("pause-btn"),
    resetBtn: $("reset-btn"),
    speedRange: $("speed-range"),
    speedLabel: $("speed-label"),
    graphSvg: $("graph-svg"),
    graphContainer: $("graph-container"),
    graphEmptyHint: $("graph-empty-hint"),
    sweeperIcon: $("sweeper-icon"),
    statusLog: $("status-log"),
    statNodes: $("stat-nodes"),
    statEdges: $("stat-edges"),
    statLengthOriginal: $("stat-length-original"),
    statLengthOptimized: $("stat-length-optimized"),
    eulerStatus: $("euler-status"),
    oddNodesList: $("odd-nodes-list"),
    routeSteps: $("route-steps"),
    progressFill: $("progress-fill"),
    progressPercent: $("progress-percent"),
    progressDistance: $("progress-distance"),
    summaryBox: $("summary-box"),
  });
}

function logStatus(msg) {
  const now = new Date();
  const time = now.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  elements.statusLog.textContent = `[${time}] ${msg}`;
}

//Hỗ trợ đồ thị (bậc đỉnh, liên thông, tập đỉnh)

function recomputeNodes() {
  state.nodes = new Set();
  state.edges.forEach((e) => {
    state.nodes.add(e.from);
    state.nodes.add(e.to);
  });
}

function getAdjacency() {
  const adj = new Map();
  state.nodes.forEach((n) => adj.set(n, []));
  state.edges.forEach((e) => {
    adj.get(e.from).push(e.to);
    adj.get(e.to).push(e.from);
  });
  return adj;
}

function isConnected() {
  if (state.nodes.size === 0) return false;
  const adj = getAdjacency();
  // find first node with degree > 0
  let start = null;
  for (const n of state.nodes) {
    if (adj.get(n).length > 0) {
      start = n;
      break;
    }
  }
  if (!start) return false;
  const visited = new Set();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop();
    if (visited.has(n)) continue;
    visited.add(n);
    adj.get(n).forEach((nb) => {
      if (!visited.has(nb)) stack.push(nb);
    });
  }
  for (const n of state.nodes) {
    if (adj.get(n).length > 0 && !visited.has(n)) {
      return false;
    }
  }
  return true;
}

function analyzeEuler() {
  const adj = getAdjacency();
  const oddNodes = [];
  for (const n of state.nodes) {
    const deg = adj.get(n).length;
    if (deg % 2 !== 0) oddNodes.push(n);
  }
  state.oddNodes = oddNodes;
  state.isConnected = isConnected();
  if (!state.isConnected) {
    state.eulerType = "none";
  } else if (oddNodes.length === 0) {
    state.eulerType = "eulerian";
  } else if (oddNodes.length === 2) {
    state.eulerType = "semi";
  } else {
    state.eulerType = "none";
  }
}


function buildEdgeKey(e) {
  return `${e.from}|${e.to}|${e.id}`;
}

function hierholzer(startNode, edges) {
  // edges: array of {id, from, to, length}
  const edgeUsed = new Set();
  const adj = new Map();
  edges.forEach((e) => {
    const key = buildEdgeKey(e);
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from).push({ to: e.to, edge: e, key });
    adj.get(e.to).push({ to: e.from, edge: e, key });
  });

  const stack = [startNode];
  const pathNodes = [];
  const pathEdges = []; // {edge, from, to}

  while (stack.length > 0) {
    const v = stack[stack.length - 1];
    const neighbors = adj.get(v) || [];
    let foundEdge = null;
    while (neighbors.length > 0) {
      const candidate = neighbors.pop();
      if (!edgeUsed.has(candidate.key)) {
        foundEdge = candidate;
        break;
      }
    }
    if (foundEdge) {
      edgeUsed.add(foundEdge.key);
      stack.push(foundEdge.to);
      pathEdges.push({ edge: foundEdge.edge, from: v, to: foundEdge.to });
    } else {
      pathNodes.push(stack.pop());
    }
  }

  return pathEdges;
}

// Thuật toán Euler / Chinese Postman Algorithm
function computeChinesePostman(start) {
  if (state.edges.length === 0) {
    state.route = [];
    state.routeLengthOriginal = 0;
    state.routeLengthOptimized = 0;
    return;
  }
  analyzeEuler();
  state.routeLengthOriginal = state.edges.reduce(
    (sum, e) => sum + e.length,
    0
  );

  let workingEdges = [...state.edges];
  state.duplicatedEdges = [];

  // Logic xử lý Chinese Postman (hoặc Open Euler Tour)
  let needMatching = true;
  const returnStartChecked = elements.returnStart ? elements.returnStart.checked : true;

  // Nếu người dùng không muốn quay lại điểm xuất phát (Open Tour)
  // VÀ đồ thị là Semi-Eulerian (2 đỉnh bậc lẻ)
  // VÀ điểm xuất phát là một trong 2 đỉnh bậc lẻ
  // => Đã thỏa mãn điều kiện đi một mạch hết các cạnh mà không cần quay lại.
  if (
    !returnStartChecked &&
    state.eulerType === "semi" &&
    state.oddNodes.includes(start)
  ) {
    needMatching = false;
  }

  if (state.eulerType !== "eulerian" && needMatching) {
    // Chinese Postman chính xác: ghép cặp các đỉnh bậc lẻ sao cho tổng đường đi thêm nhỏ nhất
    const oddNodes = state.oddNodes.slice();
    const m = oddNodes.length;
    if (m % 2 === 0 && m > 0) {
      // Tạo adjacency có trọng số
      const adj = new Map();
      state.nodes.forEach((n) => adj.set(n, []));
      state.edges.forEach((e) => {
        adj.get(e.from).push({ to: e.to, w: e.length });
        adj.get(e.to).push({ to: e.from, w: e.length });
      });

      // Dijkstra trả về khoảng cách giữa một nút và tất cả nút khác
      function dijkstra(source) {
        const dist = new Map();
        const prev = new Map();
        state.nodes.forEach((n) => dist.set(n, Infinity));
        dist.set(source, 0);
        const visited = new Set();
        while (true) {
          let u = null;
          let best = Infinity;
          for (const [node, d] of dist.entries()) {
            if (!visited.has(node) && d < best) {
              best = d;
              u = node;
            }
          }
          if (u === null) break;
          visited.add(u);
          const neighbors = adj.get(u) || [];
          neighbors.forEach(({ to, w }) => {
            const alt = dist.get(u) + w;
            if (alt < dist.get(to)) {
              dist.set(to, alt);
              prev.set(to, u);
            }
          });
        }
        return { dist, prev };
      }

      // Khoảng cách giữa các đỉnh bậc lẻ
      const oddDist = Array.from({ length: m }, () => Array(m).fill(0));
      const allPrev = {};
      for (let i = 0; i < m; i++) {
        const s = oddNodes[i];
        const { dist, prev } = dijkstra(s);
        allPrev[s] = prev;
        for (let j = 0; j < m; j++) {
          const t = oddNodes[j];
          oddDist[i][j] = dist.get(t);
        }
      }

      // DP ghép cặp tối ưu (bitmask)
      const size = 1 << m;
      const dp = new Array(size).fill(Infinity);
      const choice = new Array(size).fill(null);
      dp[0] = 0;

      for (let mask = 1; mask < size; mask++) {
        // tìm bit đầu tiên còn bật
        let i = 0;
        while (i < m && ((mask >> i) & 1) === 0) i++;
        if (i >= m) continue;
        for (let j = i + 1; j < m; j++) {
          if ((mask >> j) & 1) {
            const newMask = mask ^ (1 << i) ^ (1 << j);
            const cost = oddDist[i][j] + dp[newMask];
            if (cost < dp[mask]) {
              dp[mask] = cost;
              choice[mask] = [i, j];
            }
          }
        }
      }

      // Truy vết các cặp ghép
      const pairs = [];
      let mask = size - 1;
      while (mask) {
        const ch = choice[mask];
        if (!ch) break;
        const [i, j] = ch;
        pairs.push([oddNodes[i], oddNodes[j]]);
        mask = mask ^ (1 << i) ^ (1 << j);
      }

      // Từ các cặp, nhân đôi các cạnh trên đường đi ngắn nhất giữa chúng
      let dupIndex = 1;
      function reconstructPath(from, to, prevMap) {
        const path = [];
        let cur = to;
        while (cur !== undefined && cur !== from) {
          path.push(cur);
          cur = prevMap.get(cur);
        }
        if (cur === from) {
          path.push(from);
          path.reverse();
          return path;
        }
        return null;
      }

      pairs.forEach(([u, v]) => {
        const prevMap = allPrev[u];
        const path = reconstructPath(u, v, prevMap);
        if (!path || path.length < 2) return;
        for (let k = 0; k < path.length - 1; k++) {
          const a = path[k];
          const b = path[k + 1];
          const baseEdge = state.edges.find(
            (e) =>
              (e.from === a && e.to === b) || (e.from === b && e.to === a)
          );
          if (!baseEdge) continue;
          const dup = {
            id: `${baseEdge.id}_dup${dupIndex++}`,
            from: baseEdge.from,
            to: baseEdge.to,
            length: baseEdge.length,
            duplicateOf: baseEdge.id,
          };
          state.duplicatedEdges.push(dup);
        }
      });

      workingEdges = [...state.edges, ...state.duplicatedEdges];
    } else {
      workingEdges = [...state.edges];
    }
  }

  const routeEdges = hierholzer(start, workingEdges);
  state.route = routeEdges.map((step) => ({
    edge: step.edge,
    from: step.from,
    to: step.to,
    isDuplicate: !!step.edge.duplicateOf,
  }));

  state.routeLengthOptimized = workingEdges.reduce(
    (sum, e) => sum + e.length,
    0
  );

  refreshSummary();
}

// Bố trí & vẽ SVG (đồ thị, nhãn cạnh)
function computeLayout() {
  const w = elements.graphContainer.clientWidth || 600;
  const h = elements.graphContainer.clientHeight || 400;

  const positions = new Map();
  if (state.drawNodes.size > 0) {
    // dùng vị trí do người dùng vẽ
    state.drawNodes.forEach((pos, node) => {
      positions.set(node, { x: pos.x * w, y: pos.y * h });
    });
    // nếu có nút mới chưa có trong drawNodes thì bố trí tạm theo vòng tròn
    const missing = Array.from(state.nodes).filter((n) => !positions.has(n));
    const m = missing.length;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.34;
    missing.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, m);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      positions.set(node, { x, y });
      state.drawNodes.set(node, { x: x / w, y: y / h });
    });
  } else {
    // bố trí mặc định hình vòng tròn
    const nodesArr = Array.from(state.nodes);
    const n = nodesArr.length;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.34;
    nodesArr.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, n);
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      positions.set(node, { x, y });
    });
  }
  return { positions, width: w, height: h };
}

function renderGraph() {
  const svg = elements.graphSvg;
  const hasEdges = state.edges.length > 0;
  elements.graphEmptyHint.style.display = hasEdges ? "none" : "flex";

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (!hasEdges) return;

  const { positions, width, height } = computeLayout();
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);

  // Draw edges (base)
  state.edges.forEach((e) => {
    const p1 = positions.get(e.from);
    const p2 = positions.get(e.to);
    if (!p1 || !p2) return;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", p1.x);
    line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x);
    line.setAttribute("y2", p2.y);
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.classList.add("edge-base");
    line.dataset.edgeId = e.id;
    svg.appendChild(line);

    // length label at midpoint
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    label.setAttribute("x", mx);
    label.setAttribute("y", my - 6); // slightly above the edge
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#111827");
    label.setAttribute("paint-order", "stroke");
    label.setAttribute("stroke", "white");
    label.setAttribute("stroke-width", "2");
    label.textContent = String(e.length);
    svg.appendChild(label);
  });

  // Highlight duplicated edges (in red)
  state.duplicatedEdges.forEach((e) => {
    const p1 = positions.get(e.from);
    const p2 = positions.get(e.to);
    if (!p1 || !p2) return;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", p1.x);
    line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x);
    line.setAttribute("y2", p2.y);
    line.setAttribute("stroke-width", "4");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke", "rgba(255,59,48,0.9)");
    line.setAttribute("stroke-dasharray", "6 4");
    svg.appendChild(line);
  });

  // Draw nodes
  state.nodes.forEach((node) => {
    const pos = positions.get(node);
    if (!pos) return;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    const circle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle"
    );
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", 12);
    circle.setAttribute("fill", "#0e141f");
    circle.setAttribute("stroke", "rgba(255,255,255,0.22)");
    circle.setAttribute("stroke-width", "1.5");

    const text = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    text.setAttribute("x", pos.x);
    text.setAttribute("y", pos.y + 4);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "11");
    text.setAttribute("fill", "#f7f7f7");
    text.textContent = node;

    g.appendChild(circle);
    g.appendChild(text);
    svg.appendChild(g);
  });
}

function updateEdgeStylesForSimulation(progressIndex) {
  const total = state.route.length;
  const doneSet = new Set();
  for (let i = 0; i < progressIndex; i++) {
    const step = state.route[i];
    if (step && step.edge) {
      doneSet.add(step.edge.id);
    }
  }
  const currentStep = state.route[progressIndex];
  const curId = currentStep && currentStep.edge ? currentStep.edge.id : null;

  const lines = elements.graphSvg.querySelectorAll("line.edge-base");
  lines.forEach((line) => {
    const id = line.dataset.edgeId;
    const isDuplicate = state.duplicatedEdges.some((e) => e.id === id);
    if (id === curId) {
      line.setAttribute("stroke", "#f97316");
      line.setAttribute("stroke-width", "5");
    } else if (doneSet.has(id)) {
      line.setAttribute("stroke", "#3b82f6");
      line.setAttribute("stroke-width", "4");
    } else {
      line.setAttribute("stroke", "rgba(191, 219, 254, 0.8)");
      line.setAttribute("stroke-width", "3");
    }
    if (isDuplicate) {
      // keep red dash overlay drawn separately
    }
  });
}

// ===== Cập nhật UI (bảng cạnh, panel, tóm tắt) =====

function refreshEdgeTable() {
  elements.edgeTableBody.innerHTML = "";
  state.edges.forEach((e, idx) => {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `<span>${idx + 1}</span>
      <span>${e.from}</span>
      <span>${e.to}</span>
      <span>${e.length}</span>`;
    elements.edgeTableBody.appendChild(row);
  });
}

function refreshStartNodeOptions() {
  const select = elements.startNode;
  const current = select.value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.nodes.size ? "Chọn điểm xuất phát" : "—";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);
  state.nodes.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n;
    if (n === current) opt.selected = true;
    select.appendChild(opt);
  });
}

function refreshStats() {
  elements.statNodes.textContent = state.nodes.size;
  elements.statEdges.textContent = state.edges.length;
  elements.statLengthOriginal.textContent = state.routeLengthOriginal;
  elements.statLengthOptimized.textContent = state.routeLengthOptimized;
}

function refreshSummary() {
  if (!elements.summaryBox) return;

  if (!state.edges.length) {
    elements.summaryBox.textContent =
      "Chưa có dữ liệu. Hãy nhập mạng lưới đường hoặc tạo ví dụ mẫu, sau đó bấm \"Tính lộ trình tối ưu\" để xem phân tích.";
    return;
  }

  const totalEdges = state.edges.length;
  const duplicateCount = state.duplicatedEdges.length;
  const totalOriginal = state.routeLengthOriginal;
  const totalOptimized = state.routeLengthOptimized;
  const extra = Math.max(0, totalOptimized - totalOriginal);
  const extraPercent =
    totalOptimized > 0 ? Math.round((extra / totalOptimized) * 100) : 0;

  let eulerLine = "";
  if (!state.isConnected) {
    eulerLine =
      "Đồ thị không liên thông → cần kết nối lại trước khi có thể tối ưu lộ trình quét toàn mạng lưới.";
  } else if (state.eulerType === "eulerian") {
    eulerLine =
      "Đồ thị Eulerian → tồn tại chu trình đi qua mỗi đoạn đường đúng 1 lần và quay về điểm xuất phát.";
  } else if (state.eulerType === "semi") {
    eulerLine =
      "Đồ thị Semi-Eulerian (2 đỉnh bậc lẻ) → tồn tại đường Euler nhưng không khép kín.";
  } else {
    eulerLine =
      "Đồ thị không Eulerian (nhiều hơn 2 đỉnh bậc lẻ) → buộc phải đi lặp lại một số đoạn đường.";
  }

  const summary = [
    `- Số đỉnh: ${state.nodes.size}    Số cạnh: ${totalEdges}`,
    `- Tổng độ dài ban đầu (không lặp): ${totalOriginal}`,
    `- Tổng độ dài sau tối ưu (có các đoạn phải đi lại): ${totalOptimized}`,
    `- Phần quãng đường đi lặp lại: ${extra} (${extraPercent}% tổng lộ trình)`,
    "",
    `Phân tích Euler: ${eulerLine}`,
    "",
    "Quy ước màu sắc trên bản đồ:",
    "• Xanh dương: các đoạn thuộc lộ trình tối ưu.",
    "• Đỏ đứt đoạn: các đoạn phải đi lặp lại theo tối ưu Chinese Postman.",
    "• Cam: đoạn xe đang đi trong mô phỏng.",
  ].join("\n");

  elements.summaryBox.textContent = summary;
}

function refreshEulerPanel() {
  const el = elements.eulerStatus;
  el.classList.remove("ok", "semi", "bad", "unknown");
  el.classList.add(state.eulerType || "unknown");

  let text = "Chưa phân tích";
  if (!state.nodes.size) {
    text = "Chưa có dữ liệu mạng lưới.";
  } else if (!state.isConnected) {
    text = "Đồ thị không liên thông – không tồn tại hành trình Euler.";
  } else if (state.eulerType === "eulerian") {
    text = "Đồ thị Eulerian – tồn tại chu trình Euler khép kín.";
  } else if (state.eulerType === "semi") {
    text =
      "Đồ thị Semi-Eulerian – chỉ tồn tại đường Euler (hai đỉnh bậc lẻ).";
  } else if (state.eulerType === "none") {
    text = `Đồ thị không Eulerian – có ${state.oddNodes.length} đỉnh bậc lẻ.`;
  }
  el.textContent = text;

  elements.oddNodesList.innerHTML = "";
  if (state.oddNodes.length) {
    state.oddNodes.forEach((n) => {
      const li = document.createElement("li");
      li.textContent = `Đỉnh ${n}`;
      elements.oddNodesList.appendChild(li);
    });
  }
}

function refreshRouteSteps() {
  elements.routeSteps.innerHTML = "";
  state.route.forEach((step, idx) => {
    const li = document.createElement("li");
    const e = step.edge;
    const dupLabel = step.isDuplicate ? " — cạnh đi lặp lại theo tối ưu Chinese Postman" : "";
    li.textContent = `${idx + 1}. ${step.from} → ${step.to} (d = ${e.length})${dupLabel}`;
    elements.routeSteps.appendChild(li);
  });
}

function resetSimulation() {
  state.simIndex = 0;
  state.simProgress = 0;
  state.simRunning = false;
  state.sweeperPos = null;
  elements.sweeperIcon.style.opacity = 0;
  updateProgressUI();
  updateEdgeStylesForSimulation(0);
  refreshSummary();
}

function updateProgressUI() {
  const totalSteps = state.route.length;
  const completed = Math.min(state.simIndex, totalSteps);
  const percent = totalSteps === 0 ? 0 : Math.round((completed / totalSteps) * 100);
  elements.progressFill.style.width = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;

  const doneDist = state.route
    .slice(0, completed)
    .reduce((sum, step) => sum + step.edge.length, 0);
  elements.progressDistance.textContent = `${doneDist} / ${state.routeLengthOptimized}`;
}

// Vòng lặp mô phỏng

let lastTimestamp = null;

function animate(timestamp) {
  if (!state.simRunning) {
    lastTimestamp = null;
  } else {
    if (lastTimestamp == null) lastTimestamp = timestamp;
    const dt = (timestamp - lastTimestamp) / 1000; // seconds
    lastTimestamp = timestamp;

    const speedFactor = state.simSpeed * 0.5; // slower global factor
    state.simProgress += dt * speedFactor;

    const nextIndex = Math.floor(state.simProgress);
    if (nextIndex !== state.simIndex) {
      state.simIndex = nextIndex;
      if (state.simIndex >= state.route.length) {
        state.simIndex = state.route.length;
        state.simRunning = false;
        logStatus("Mô phỏng hoàn tất: tất cả đoạn đường đã được quét.");
      }
      updateEdgeStylesForSimulation(state.simIndex);
      updateProgressUI();
    }
  }

  // Cập nhật vị trí xe mượt mà theo thời gian (ngay cả khi chưa sang cạnh mới)
  updateSweeperPosition();

  requestAnimationFrame(animate);
}

function updateSweeperPosition() {
  if (!state.route.length || state.simProgress <= 0) {
    // Đặt xe tại điểm xuất phát khi chưa chạy
    const { positions } = computeLayout();
    const first = state.route[0];
    if (first) {
      const startPos = positions.get(first.from);
      if (startPos) {
        elements.sweeperIcon.style.opacity = 1;
        elements.sweeperIcon.style.left = `${startPos.x}px`;
        elements.sweeperIcon.style.top = `${startPos.y}px`;
      }
    } else {
      elements.sweeperIcon.style.opacity = 0;
    }
    return;
  }
  const { positions } = computeLayout();
  const idx = Math.floor(state.simProgress);

  if (idx >= state.route.length) {
    // Đặt xe tại điểm cuối cùng của cạnh cuối
    const lastStep = state.route[state.route.length - 1];
    if (!lastStep) return;
    const lastPos = positions.get(lastStep.edge.to);
    if (!lastPos) return;
    elements.sweeperIcon.style.opacity = 1;
    elements.sweeperIcon.style.left = `${lastPos.x}px`;
    elements.sweeperIcon.style.top = `${lastPos.y}px`;
    return;
  }

  const step = state.route[idx];
  if (!step) return;
  const e = step.edge;
  const p1 = positions.get(step.from);
  const p2 = positions.get(step.to);
  if (!p1 || !p2) return;

  const t = Math.max(0, Math.min(1, state.simProgress - idx));
  const x = p1.x + (p2.x - p1.x) * t;
  const y = p1.y + (p2.y - p1.y) * t;
  elements.sweeperIcon.style.opacity = 1;
  elements.sweeperIcon.style.left = `${x}px`;
  elements.sweeperIcon.style.top = `${y}px`;
}

// Xử lý sự kiện UI
function onAddEdge(e) {
  e.preventDefault();
  const from = elements.fromNode.value.trim();
  const to = elements.toNode.value.trim();
  const length = Number(elements.length.value);
  if (!from || !to || !(length > 0)) {
    alert("Vui lòng nhập đầy đủ điểm đầu, điểm cuối và độ dài hợp lệ.");
    return;
  }
  const id = `e${state.edges.length + 1}`;
  state.edges.push({ id, from, to, length });
  recomputeNodes();
  refreshEdgeTable();
  refreshStartNodeOptions();
  renderGraph();
  analyzeEuler();
  refreshEulerPanel();
  state.route = [];
  state.routeLengthOriginal = 0;
  state.routeLengthOptimized = 0;
  refreshStats();
  elements.routeSteps.innerHTML = "";
  resetSimulation();
  logStatus(`Đã thêm đoạn đường ${from} → ${to} (d = ${length}).`);
  elements.edgeForm.reset();
}

function addEdgeDirect(from, to, length) {
  const id = `e${state.edges.length + 1}`;
  state.edges.push({ id, from, to, length });
}

function normalizeNodeName(name) {
  return name.trim();
}

function onBulkAdd() {
  const text = (elements.bulkEdges.value || "").trim();
  if (!text) {
    alert("Hãy nhập ít nhất một dòng theo dạng: A B 10");
    return;
  }

  // Mỗi lần bấm "Thêm" coi như nhập lại hoàn toàn mạng lưới
  state.edges = [];
  state.duplicatedEdges = [];
  state.drawNodes.clear();
  state.route = [];
  state.routeLengthOriginal = 0;
  state.routeLengthOptimized = 0;

  const lines = text.split(/\r?\n/);
  let added = 0;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const from = normalizeNodeName(parts[0]);
    const to = normalizeNodeName(parts[1]);
    const len = Number(parts[2]);
    if (!from || !to || !(len > 0)) continue;
    addEdgeDirect(from, to, len);
    added++;
  }
  if (!added) {
    alert("Không có dòng hợp lệ. Định dạng: A B 10");
    return;
  }
  recomputeNodes();
  refreshEdgeTable();
  refreshStartNodeOptions();
  renderGraph();
  analyzeEuler();
  refreshEulerPanel();
  state.route = [];
  state.routeLengthOriginal = 0;
  state.routeLengthOptimized = 0;
  refreshStats();
  elements.routeSteps.innerHTML = "";
  resetSimulation();
  logStatus(`Đã thêm ${added} đoạn đường từ ô nhập nhiều dòng.`);
}


function screenToRelative(x, y) {
  const rect = elements.graphContainer.getBoundingClientRect();
  return {
    x: (x - rect.left) / rect.width,
    y: (y - rect.top) / rect.height,
  };
}

function findNearestNode(x, y, thresholdPx = 18) {
  if (!state.nodes.size) return null;
  const { positions } = computeLayout();
  let best = null;
  let bestDist = Infinity;
  state.nodes.forEach((n) => {
    const p = positions.get(n);
    if (!p) return;
    const dx = p.x - x;
    const dy = p.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist && d <= thresholdPx) {
      bestDist = d;
      best = n;
    }
  });
  return best;
}

function onGraphMouseDown(ev) {
  if (!state.drawMode) return;
  const { x, y } = screenToRelative(ev.clientX, ev.clientY);
  const absW = elements.graphContainer.clientWidth || 600;
  const absH = elements.graphContainer.clientHeight || 400;
  const absX = x * absW;
  const absY = y * absH;

  const near = findNearestNode(absX, absY);
  if (near) {
    state.draggingFrom = near;
  } else {
    let idNum = state.nodes.size + 1;
    let nodeId = String(idNum);
    while (state.nodes.has(nodeId)) {
      idNum += 1;
      nodeId = String(idNum);
    }
    state.nodes.add(nodeId);
    state.drawNodes.set(nodeId, { x, y });
    recomputeNodes();
    refreshStartNodeOptions();
    renderGraph();
    analyzeEuler();
    refreshEulerPanel();
    refreshStats();
    logStatus(`Đã thêm nút ${nodeId} bằng chuột.`);
  }
}

function onGraphMouseUp(ev) {
  if (!state.drawMode || !state.draggingFrom) return;
  const from = state.draggingFrom;
  state.draggingFrom = null;

  const { x, y } = screenToRelative(ev.clientX, ev.clientY);
  const absW = elements.graphContainer.clientWidth || 600;
  const absH = elements.graphContainer.clientHeight || 400;
  const absX = x * absW;
  const absY = y * absH;
  const to = findNearestNode(absX, absY);
  if (!to || to === from) return;

  const length = 1;
  addEdgeDirect(from, to, length);
  recomputeNodes();
  refreshEdgeTable();
  refreshStartNodeOptions();
  renderGraph();
  analyzeEuler();
  refreshEulerPanel();
  state.route = [];
  state.routeLengthOriginal = 0;
  state.routeLengthOptimized = 0;
  refreshStats();
  elements.routeSteps.innerHTML = "";
  resetSimulation();
  logStatus(`Đã thêm cạnh ${from} → ${to} bằng thao tác kéo chuột.`);
}

function toggleDrawMode() {
  state.drawMode = !state.drawMode;
  if (state.drawMode) {
    elements.drawModeBtn.classList.add("active");
    logStatus("Đã bật chế độ vẽ bằng chuột.");
  } else {
    elements.drawModeBtn.classList.remove("active");
    state.draggingFrom = null;
    logStatus("Đã tắt chế độ vẽ bằng chuột.");
  }
}

function loadSampleGraph() {
  // Ví dụ mẫu Euler / Chinese Postman (lấy cảm hứng từ GraphOnline)
  state.edges = [
    { id: "e1", from: "A", to: "E", length: 2 },
    { id: "e2", from: "E", to: "F", length: 2 },
    { id: "e3", from: "F", to: "B", length: 2 },
    { id: "e4", from: "B", to: "G", length: 2 },
    { id: "e5", from: "G", to: "C", length: 2 },
    { id: "e6", from: "C", to: "D", length: 2 },
    { id: "e7", from: "D", to: "H", length: 2 },
    { id: "e8", from: "H", to: "A", length: 2 },
    { id: "e9", from: "E", to: "G", length: 2 },
    { id: "e10", from: "F", to: "C", length: 2 },
  ];
  state.drawNodes.clear();
  recomputeNodes();
  refreshEdgeTable();
  refreshStartNodeOptions();
  renderGraph();
  analyzeEuler();
  refreshEulerPanel();
  state.route = [];
  state.routeLengthOriginal = 0;
  state.routeLengthOptimized = 0;
  refreshStats();
  elements.routeSteps.innerHTML = "";
  resetSimulation();
  logStatus("Đã tạo ví dụ mẫu mạng lưới 4 nút A–D.");
}

function clearGraph() {
  state.edges = [];
  state.drawNodes.clear();
  state.draggingFrom = null;
  recomputeNodes();
  renderGraph();
  refreshEdgeTable();
  refreshStartNodeOptions();
  state.eulerType = "unknown";
  state.oddNodes = [];
  state.route = [];
  state.routeLengthOriginal = 0;
  state.routeLengthOptimized = 0;
  refreshStats();
  refreshEulerPanel();
  resetSimulation();
  logStatus("Đã xóa toàn bộ mạng lưới.");
}

function onAnalyze() {
  if (!state.edges.length) {
    alert("Chưa có dữ liệu mạng lưới.");
    return;
  }
  analyzeEuler();
  refreshEulerPanel();
  logStatus("Đã phân tích trạng thái Euler của mạng lưới.");
}

function onComputeRoute() {
  if (!state.edges.length) {
    alert("Chưa có dữ liệu mạng lưới.");
    return;
  }
  const start = elements.startNode.value || Array.from(state.nodes)[0];
  if (!start) {
    alert("Không tìm thấy nút xuất phát.");
    return;
  }
  computeChinesePostman(start);
  refreshStats();
  refreshRouteSteps();
  renderGraph();
  updateEdgeStylesForSimulation(0);
  resetSimulation();
  logStatus(
    `Đã tính lộ trình tối ưu theo Chinese Postman (gần đúng) từ nút ${start}.`
  );
}

function onPlay() {
  if (!state.route.length) {
    alert("Chưa có lộ trình. Hãy nhấn 'Tính lộ trình tối ưu' trước.");
    return;
  }
  if (state.simIndex >= state.route.length) {
    resetSimulation();
  }
  state.simRunning = true;
  logStatus("Đang chạy mô phỏng xe quét.");
}

function onPause() {
  if (!state.simRunning) return;
  state.simRunning = false;
  logStatus("Đã tạm dừng mô phỏng.");
}

function onReset() {
  resetSimulation();
  logStatus("Đã reset mô phỏng về trạng thái ban đầu.");
}

function onSpeedChange() {
  const val = Number(elements.speedRange.value) || 1;
  state.simSpeed = val;
  const display = (val * 0.5).toFixed(2);
  elements.speedLabel.textContent = `${display}x`.replace(".00", "x");
}

function init() {
  cacheElements();

  elements.loadSample.addEventListener("click", loadSampleGraph);
  elements.clearGraph.addEventListener("click", clearGraph);
  elements.bulkAddBtn.addEventListener("click", onBulkAdd);
  if (elements.drawModeBtn) {
    elements.drawModeBtn.addEventListener("click", toggleDrawMode);
  }
  elements.graphContainer.addEventListener("mousedown", onGraphMouseDown);
  window.addEventListener("mouseup", onGraphMouseUp);
  elements.analyzeBtn.addEventListener("click", onAnalyze);
  elements.computeRouteBtn.addEventListener("click", onComputeRoute);
  elements.playBtn.addEventListener("click", onPlay);
  elements.pauseBtn.addEventListener("click", onPause);
  elements.resetBtn.addEventListener("click", onReset);
  elements.speedRange.addEventListener("input", onSpeedChange);

  state.simSpeed = Number(elements.speedRange.value) || 0.4;
  const initDisplay = (state.simSpeed * 0.5).toFixed(2);
  elements.speedLabel.textContent = `${initDisplay}x`.replace(".00", "x");

  refreshEdgeTable();
  refreshStartNodeOptions();
  refreshStats();
  refreshEulerPanel();
  renderGraph();
  updateProgressUI();
  refreshSummary();
  logStatus("Sẵn sàng. Hãy nhập mạng lưới đường hoặc tạo ví dụ mẫu để bắt đầu.");

  window.addEventListener("resize", () => {
    renderGraph();
    updateEdgeStylesForSimulation(state.simIndex);
    updateSweeperPosition();
  });

  requestAnimationFrame(animate);
}

window.addEventListener("DOMContentLoaded", init);


