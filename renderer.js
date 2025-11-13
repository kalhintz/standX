const { ipcRenderer } = require('electron');

// 전역 상태
let isConnected = false;
let autoRefreshInterval = null;
let botStatusInterval = null;
let quoteTimeout = null;
let tokenBalances = {
  DUSD: '0',
  USDT: '0'
};

// DOM 요소
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const totalBalance = document.getElementById('total-balance');
const availableBalance = document.getElementById('available-balance');
const equityBalance = document.getElementById('equity-balance');
const upnlBalance = document.getElementById('upnl-balance');
const activityLog = document.getElementById('activity-log');

// 토큰 주소
const TOKENS = {
  DUSD: '0xaf44A1E76F56eE12ADBB7ba8acD3CbD474888122',
  USDT: '0x55d398326f99059fF775485246999027B3197955'
};

// 페이지 로드 시 저장된 정보 불러오기
window.addEventListener('DOMContentLoaded', () => {
  loadSavedCredentials();
});

// 저장된 로그인 정보 불러오기
async function loadSavedCredentials() {
  try {
    const result = await ipcRenderer.invoke('load-config');
    if (result.success && result.data.credentials) {
      const cred = result.data.credentials;

      if (cred.walletAddress) {
        document.getElementById('wallet-address').value = cred.walletAddress;
      }
      if (cred.privateKey) {
        document.getElementById('private-key').value = cred.privateKey;
      }
      if (cred.chain) {
        document.getElementById('chain-select').value = cred.chain;
      }
      if (cred.saveCredentials === 'true') {
        document.getElementById('save-credentials').checked = true;
        addLog('저장된 로그인 정보를 불러왔습니다', 'info');
      }
    }
  } catch (error) {
    console.error('설정 불러오기 실패:', error);
  }
}

// 로그인 정보 저장
async function saveCredentials(walletAddress, privateKey, chain) {
  const shouldSave = document.getElementById('save-credentials').checked;

  try {
    if (shouldSave) {
      const config = {
        credentials: {
          walletAddress,
          privateKey,
          chain,
          saveCredentials: 'true'
        }
      };

      const result = await ipcRenderer.invoke('save-config', config);
      if (result.success) {
        addLog('로그인 정보가 저장되었습니다', 'success');
      }
    } else {
      await clearSavedCredentials();
    }
  } catch (error) {
    console.error('설정 저장 실패:', error);
    addLog('설정 저장 실패', 'error');
  }
}

// 저장된 정보 삭제
async function clearSavedCredentials() {
  try {
    const config = {
      credentials: {
        walletAddress: '',
        privateKey: '',
        chain: '',
        saveCredentials: 'false'
      }
    };
    await ipcRenderer.invoke('save-config', config);
  } catch (error) {
    console.error('설정 삭제 실패:', error);
  }
}

// 탭 전환
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(tabId).classList.add('active');

    // 토큰 스왑 탭으로 전환 시 잔고 새로고침
    if (tabId === 'token-swap' && isConnected) {
      refreshTokenBalances();
    }
  });
});

// 로그 추가
function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('ko-KR');
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${type}`;
  logEntry.textContent = `[${timestamp}] ${message}`;
  activityLog.insertBefore(logEntry, activityLog.firstChild);

  while (activityLog.children.length > 100) {
    activityLog.removeChild(activityLog.lastChild);
  }
}

// 연결 상태 업데이트
function updateConnectionStatus(connected) {
  isConnected = connected;
  if (connected) {
    statusIndicator.classList.remove('disconnected');
    statusIndicator.classList.add('connected');
    statusText.textContent = '연결됨';
    addLog('API 연결 성공', 'success');
  } else {
    statusIndicator.classList.remove('connected');
    statusIndicator.classList.add('disconnected');
    statusText.textContent = '연결 안됨';
    addLog('API 연결 끊김', 'error');
  }
}

// 포인트 새로고침
async function refreshPoints() {
  if (!isConnected) return;

  try {
    const result = await ipcRenderer.invoke('get-points');
    if (result.success) {
      const points = result.data;

      // 포인트는 1,000,000으로 나눠서 표시
      const totalPoints = parseInt(points.total_point) / 1000000;
      const swapPoints = parseInt(points.swap_point) / 1000000;
      const dusdPoints = parseInt(points.dusd_point) / 1000000;

      document.getElementById('total-points').textContent = totalPoints.toFixed(1);
      document.getElementById('swap-points').textContent = swapPoints.toFixed(1);
      document.getElementById('dusd-points').textContent = dusdPoints.toFixed(1);
      document.getElementById('rank').textContent = `#${parseInt(points.rank).toLocaleString()}`;
    }
  } catch (error) {
    console.error('포인트 조회 실패:', error);
  }
}

// 잔고 새로고침
async function refreshBalance() {
  if (!isConnected) return;

  try {
    const result = await ipcRenderer.invoke('get-balance');
    if (result.success) {
      const balance = result.data;
      totalBalance.textContent = `${parseFloat(balance.balance || 0).toFixed(2)} DUSD`;
      availableBalance.textContent = `${parseFloat(balance.cross_available || 0).toFixed(2)} DUSD`;
      equityBalance.textContent = `${parseFloat(balance.equity || 0).toFixed(2)} DUSD`;

      const upnl = parseFloat(balance.upnl || 0);
      upnlBalance.textContent = `${upnl >= 0 ? '+' : ''}${upnl.toFixed(2)} DUSD`;
      upnlBalance.style.color = upnl >= 0 ? '#4ade80' : '#f87171';
    }

    // 포인트도 함께 새로고침
    await refreshPoints();
  } catch (error) {
    addLog(`잔고 조회 실패: ${error.message}`, 'error');
  }
}

// 토큰 잔고 새로고침
async function refreshTokenBalances() {
  if (!isConnected) return;

  try {
    // DUSD 잔고
    const dusdResult = await ipcRenderer.invoke('get-token-balance', TOKENS.DUSD);
    if (dusdResult.success) {
      tokenBalances.DUSD = dusdResult.data.formatted;
      document.getElementById('dusd-balance').textContent = parseFloat(tokenBalances.DUSD).toFixed(2);
    }

    // USDT 잔고
    const usdtResult = await ipcRenderer.invoke('get-token-balance', TOKENS.USDT);
    if (usdtResult.success) {
      tokenBalances.USDT = usdtResult.data.formatted;
      document.getElementById('usdt-balance').textContent = parseFloat(tokenBalances.USDT).toFixed(2);
    }

    // 현재 선택된 토큰 잔고 업데이트
    updateSwapBalanceLabels();

    addLog('토큰 잔고 업데이트 완료', 'success');
  } catch (error) {
    addLog(`토큰 잔고 조회 실패: ${error.message}`, 'error');
  }
}

// 스왑 잔고 라벨 업데이트
function updateSwapBalanceLabels() {
  const fromToken = document.getElementById('swap-token-from').value;
  const toToken = document.getElementById('swap-token-to').value;

  document.getElementById('from-balance').textContent = `잔고: ${parseFloat(tokenBalances[fromToken] || 0).toFixed(2)}`;
  document.getElementById('to-balance').textContent = `잔고: ${parseFloat(tokenBalances[toToken] || 0).toFixed(2)}`;
}

// Quote 가져오기
async function getSwapQuote() {
  const fromToken = document.getElementById('swap-token-from').value;
  const toToken = document.getElementById('swap-token-to').value;
  const amountIn = parseFloat(document.getElementById('swap-amount-in').value);

  if (!amountIn || amountIn <= 0) {
    document.getElementById('swap-amount-out').value = '';
    document.getElementById('swap-info').style.display = 'none';
    return;
  }

  try {
    const result = await ipcRenderer.invoke('get-sushi-quote', {
      fromToken,
      toToken,
      amount: amountIn
    });

    if (result.success) {
      const quote = result.data;
      document.getElementById('swap-amount-out').value = parseFloat(quote.assumedAmountOutFormatted).toFixed(6);
      document.getElementById('price-impact').textContent = (quote.priceImpact * 100).toFixed(4) + '%';
      document.getElementById('gas-estimate').textContent = quote.gasSpent.toLocaleString();
      document.getElementById('swap-info').style.display = 'block';

      // Price Impact 색상
      const priceImpactElement = document.getElementById('price-impact');
      const impact = quote.priceImpact * 100;
      if (impact < 1) {
        priceImpactElement.style.color = '#4ade80';
      } else if (impact < 3) {
        priceImpactElement.style.color = '#fbbf24';
      } else {
        priceImpactElement.style.color = '#f87171';
      }
    }
  } catch (error) {
    addLog(`Quote 조회 실패: ${error.message}`, 'error');
    document.getElementById('swap-amount-out').value = '';
    document.getElementById('swap-info').style.display = 'none';
  }
}

// 포지션 새로고침 (간단 버전 - 대시보드용)
async function refreshPositions() {
  if (!isConnected) return;

  try {
    const result = await ipcRenderer.invoke('get-positions');
    if (result.success && result.data) {
      const positionsList = document.getElementById('positions-list');
      positionsList.innerHTML = '';

      const positions = Array.isArray(result.data) ? result.data : [];
      const activePositions = positions.filter(pos => parseFloat(pos.qty) !== 0);

      if (activePositions.length === 0) {
        positionsList.innerHTML = '<p class="empty-state">포지션 없음</p>';
      } else {
        activePositions.forEach(pos => {
          const qty = parseFloat(pos.qty);
          const side = qty > 0 ? 'LONG' : 'SHORT';
          const sideClass = qty > 0 ? 'long' : 'short';
          const upnl = parseFloat(pos.upnl || 0);

          const item = document.createElement('div');
          item.className = 'position-item';
          item.innerHTML = `
            <div>
              <span class="${sideClass}">${side}</span>
              <span> ${pos.symbol}</span>
            </div>
            <div>
              <span>${Math.abs(qty)}</span>
              <span> @ ${parseFloat(pos.entry_price).toFixed(2)}</span>
              <span style="color: ${upnl >= 0 ? '#4ade80' : '#f87171'}; margin-left: 10px;">
                ${upnl >= 0 ? '+' : ''}${upnl.toFixed(2)}
              </span>
            </div>
          `;
          positionsList.appendChild(item);
        });
      }
    }
  } catch (error) {
    addLog(`포지션 조회 실패: ${error.message}`, 'error');
  }
}

// 포지션 상세 새로고침 (포지션 관리 탭용)
async function refreshPositionsDetail() {
  if (!isConnected) return;

  try {
    const result = await ipcRenderer.invoke('get-positions');
    if (result.success && result.data) {
      const positionsDetail = document.getElementById('positions-detail');
      positionsDetail.innerHTML = '';

      const positions = Array.isArray(result.data) ? result.data : [];
      const activePositions = positions.filter(pos => parseFloat(pos.qty) !== 0);

      if (activePositions.length === 0) {
        positionsDetail.innerHTML = '<p class="empty-state">포지션 없음</p>';
      } else {
        activePositions.forEach(pos => {
          const qty = parseFloat(pos.qty);
          const side = qty > 0 ? 'LONG' : 'SHORT';
          const sideClass = qty > 0 ? 'long' : 'short';
          const upnl = parseFloat(pos.upnl || 0);
          const entryPrice = parseFloat(pos.entry_price);
          const markPrice = parseFloat(pos.mark_price);
          const liqPrice = pos.liq_price ? parseFloat(pos.liq_price) : null;
          const leverage = pos.leverage;
          const marginMode = pos.margin_mode;

          const card = document.createElement('div');
          card.className = 'position-card';
          card.innerHTML = `
            <div class="position-header">
              <div>
                <span class="position-symbol">${pos.symbol}</span>
                <span class="position-side ${sideClass}">${side}</span>
                <span class="position-leverage">${leverage}x</span>
                <span class="position-margin">${marginMode}</span>
              </div>
              <button class="btn btn-small btn-danger close-position-btn" data-symbol="${pos.symbol}" data-size="${Math.abs(qty)}" data-side="${qty > 0 ? 'buy' : 'sell'}">
                ❌ 청산
              </button>
            </div>
            <div class="position-details">
              <div class="detail-row">
                <span>수량:</span>
                <span>${Math.abs(qty)}</span>
              </div>
              <div class="detail-row">
                <span>진입가:</span>
                <span>${entryPrice.toFixed(2)}</span>
              </div>
              <div class="detail-row">
                <span>현재가:</span>
                <span>${markPrice.toFixed(2)}</span>
              </div>
              <div class="detail-row">
                <span>청산가:</span>
                <span>${liqPrice ? liqPrice.toFixed(2) : 'N/A'}</span>
              </div>
              <div class="detail-row">
                <span>포지션 가치:</span>
                <span>${parseFloat(pos.position_value).toFixed(2)} DUSD</span>
              </div>
              <div class="detail-row">
                <span>미실현 손익:</span>
                <span style="color: ${upnl >= 0 ? '#4ade80' : '#f87171'}; font-weight: bold;">
                  ${upnl >= 0 ? '+' : ''}${upnl.toFixed(2)} DUSD
                </span>
              </div>
            </div>
          `;
          positionsDetail.appendChild(card);
        });

        // 청산 버튼 이벤트 리스너 추가
        document.querySelectorAll('.close-position-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const symbol = e.target.dataset.symbol;
            const size = parseFloat(e.target.dataset.size);
            const side = e.target.dataset.side;

            if (!confirm(`${symbol} 포지션을 청산하시겠습니까?\n수량: ${size}`)) {
              return;
            }

            try {
              const result = await ipcRenderer.invoke('close-position', { symbol, size, side });
              if (result.success) {
                addLog(`포지션 청산 성공: ${symbol}`, 'success');
                await refreshPositionsDetail();
                await refreshBalance();
              }
            } catch (error) {
              addLog(`포지션 청산 실패: ${error.message}`, 'error');
            }
          });
        });
      }
    }
  } catch (error) {
    addLog(`포지션 조회 실패: ${error.message}`, 'error');
  }
}

// 오픈 오더 새로고침
async function refreshOrders() {
  if (!isConnected) return;

  try {
    const result = await ipcRenderer.invoke('get-open-orders');
    if (result.success && result.data) {
      const ordersList = document.getElementById('orders-list');
      ordersList.innerHTML = '';

      const orders = result.data.result || [];

      if (orders.length === 0) {
        ordersList.innerHTML = '<p class="empty-state">오픈 오더 없음</p>';
      } else {
        orders.forEach(order => {
          const item = document.createElement('div');
          item.className = 'order-item';
          item.innerHTML = `
            <div>
              <span>${order.side.toUpperCase()}</span>
              <span> ${order.symbol}</span>
            </div>
            <div>
              <span>${order.qty}</span>
              <span> @ ${order.price}</span>
            </div>
          `;
          ordersList.appendChild(item);
        });
      }
    }
  } catch (error) {
    addLog(`오더 조회 실패: ${error.message}`, 'error');
  }
}

// 봇 상태 업데이트
async function updateBotStatus() {
  try {
    const result = await ipcRenderer.invoke('get-bot-status');
    if (result.success) {
      const status = result.data;

      const statusBadge = document.getElementById('volume-bot-status');
      if (status.running) {
        statusBadge.textContent = '실행 중';
        statusBadge.className = 'status-badge running';
      } else {
        statusBadge.textContent = '중지됨';
        statusBadge.className = 'status-badge stopped';
      }

      document.getElementById('volume-total-orders').textContent = status.stats.totalOrders;
      document.getElementById('volume-successful-orders').textContent = status.stats.successfulOrders;
      document.getElementById('volume-failed-orders').textContent = status.stats.failedOrders;
      document.getElementById('volume-total-volume').textContent = status.stats.totalVolume.toFixed(3);
      document.getElementById('volume-runtime').textContent = `${status.runtime}s`;

      document.getElementById('vb-total-orders').textContent = status.stats.totalOrders;
      const successRate = status.stats.totalOrders > 0
        ? ((status.stats.successfulOrders / status.stats.totalOrders) * 100).toFixed(1)
        : 0;
      document.getElementById('vb-success-rate').textContent = `${successRate}%`;
      document.getElementById('vb-total-volume').textContent = status.stats.totalVolume.toFixed(3);
      document.getElementById('vb-runtime').textContent = `${Math.floor(status.runtime / 60)}분`;
    }
  } catch (error) {
    console.error('봇 상태 업데이트 실패:', error);
  }
}

// API 연결
document.getElementById('connect-api').addEventListener('click', async () => {
  const chain = document.getElementById('chain-select').value;
  const walletAddress = document.getElementById('wallet-address').value.trim();
  const privateKey = document.getElementById('private-key').value.trim();

  if (!walletAddress || !privateKey) {
    addLog('Wallet Address와 Private Key를 입력하세요', 'error');
    return;
  }

  if (!walletAddress.startsWith('0x')) {
    addLog('Wallet Address는 0x로 시작해야 합니다', 'error');
    return;
  }

  addLog('인증 시작...', 'info');

  try {
    const result = await ipcRenderer.invoke('authenticate', {
      walletAddress,
      privateKey,
      chain
    });

    if (result.success) {
      updateConnectionStatus(true);
      addLog(`로그인 성공: ${result.data.address}`, 'success');

      // 로그인 정보 저장
      saveCredentials(walletAddress, privateKey, chain);

      await refreshBalance();
      await refreshPositions();
      await refreshOrders();
      await refreshTokenBalances();

      if (document.getElementById('auto-refresh').checked) {
        startAutoRefresh();
      }

      startBotStatusMonitoring();
    } else {
      addLog(`연결 실패: ${result.error}`, 'error');
    }
  } catch (error) {
    addLog(`연결 오류: ${error.message}`, 'error');
  }
});

// 연결 해제
document.getElementById('disconnect-api').addEventListener('click', () => {
  updateConnectionStatus(false);
  stopAutoRefresh();
  stopBotStatusMonitoring();

  // Private key만 초기화 (주소는 유지)
  if (!document.getElementById('save-credentials').checked) {
    document.getElementById('wallet-address').value = '';
    document.getElementById('private-key').value = '';
  }
});

// 잔고 새로고침 버튼
document.getElementById('refresh-balance').addEventListener('click', async () => {
  await refreshBalance();
  await refreshPositions();
  await refreshOrders();
});

// 포지션 새로고침 버튼
document.getElementById('refresh-positions')?.addEventListener('click', refreshPositionsDetail);

// 토큰 잔고 새로고침 버튼
document.getElementById('refresh-token-balances')?.addEventListener('click', refreshTokenBalances);

// 모든 주문 취소
document.getElementById('cancel-all-orders').addEventListener('click', async () => {
  if (!confirm('모든 오픈 오더를 취소하시겠습니까?')) return;

  try {
    const result = await ipcRenderer.invoke('cancel-all-orders');
    if (result.success) {
      addLog('모든 주문 취소 완료', 'success');
      await refreshOrders();
    }
  } catch (error) {
    addLog(`주문 취소 실패: ${error.message}`, 'error');
  }
});

// 거래량 봇 시작
document.getElementById('start-volume-bot').addEventListener('click', async () => {
  const config = {
    symbol: document.getElementById('volume-symbol').value,
    minSize: parseFloat(document.getElementById('volume-min-size').value),
    maxSize: parseFloat(document.getElementById('volume-max-size').value),
    intervalMin: parseFloat(document.getElementById('volume-interval-min').value),
    intervalMax: parseFloat(document.getElementById('volume-interval-max').value),
    priceVariance: parseFloat(document.getElementById('volume-price-variance').value) / 100
  };

  if (config.minSize < 0.0001) {
    addLog('최소 수량은 0.0001 이상이어야 합니다', 'error');
    return;
  }

  if (config.minSize > config.maxSize) {
    addLog('최소 수량이 최대 수량보다 클 수 없습니다', 'error');
    return;
  }

  if (config.intervalMin > config.intervalMax) {
    addLog('최소 간격이 최대 간격보다 클 수 없습니다', 'error');
    return;
  }

  if (!isConnected) {
    addLog('먼저 API에 연결하세요', 'error');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('start-volume-bot', config);
    if (result.success) {
      addLog(`거래량 봇 시작: ${config.symbol}`, 'success');
      addLog(`수량 범위: ${config.minSize} ~ ${config.maxSize}`, 'info');
    }
  } catch (error) {
    addLog(`봇 시작 실패: ${error.message}`, 'error');
  }
});

// 거래량 봇 중지
document.getElementById('stop-volume-bot').addEventListener('click', async () => {
  try {
    const result = await ipcRenderer.invoke('stop-volume-bot');
    if (result.success) {
      addLog('거래량 봇 중지', 'info');
    }
  } catch (error) {
    addLog(`봇 중지 실패: ${error.message}`, 'error');
  }
});

// 스왑 입력 변경 시 Quote 가져오기
document.getElementById('swap-amount-in')?.addEventListener('input', () => {
  if (quoteTimeout) clearTimeout(quoteTimeout);
  quoteTimeout = setTimeout(getSwapQuote, 500);
});

// 스왑 토큰 변경
document.getElementById('swap-token-from')?.addEventListener('change', () => {
  const fromToken = document.getElementById('swap-token-from').value;
  const toToken = document.getElementById('swap-token-to').value;

  if (fromToken === toToken) {
    document.getElementById('swap-token-to').value = fromToken === 'DUSD' ? 'USDT' : 'DUSD';
  }

  updateSwapBalanceLabels();
  getSwapQuote();
});

document.getElementById('swap-token-to')?.addEventListener('change', () => {
  const fromToken = document.getElementById('swap-token-from').value;
  const toToken = document.getElementById('swap-token-to').value;

  if (fromToken === toToken) {
    document.getElementById('swap-token-from').value = toToken === 'DUSD' ? 'USDT' : 'DUSD';
  }

  updateSwapBalanceLabels();
  getSwapQuote();
});

// 스왑 방향 전환
document.getElementById('reverse-swap')?.addEventListener('click', () => {
  const fromToken = document.getElementById('swap-token-from').value;
  const toToken = document.getElementById('swap-token-to').value;

  document.getElementById('swap-token-from').value = toToken;
  document.getElementById('swap-token-to').value = fromToken;

  document.getElementById('swap-amount-in').value = '';
  document.getElementById('swap-amount-out').value = '';
  document.getElementById('swap-info').style.display = 'none';

  updateSwapBalanceLabels();
});

// MAX 버튼
document.getElementById('use-max-btn')?.addEventListener('click', () => {
  const fromToken = document.getElementById('swap-token-from').value;
  const balance = parseFloat(tokenBalances[fromToken] || 0);

  if (balance > 0) {
    // 가스비 고려해서 약간 여유 (0.1% 차감)
    const maxAmount = balance * 0.999;
    document.getElementById('swap-amount-in').value = maxAmount.toFixed(6);
    getSwapQuote();
  }
});

// 스왑 실행
document.getElementById('execute-swap-btn')?.addEventListener('click', async () => {
  const fromToken = document.getElementById('swap-token-from').value;
  const toToken = document.getElementById('swap-token-to').value;
  const amount = parseFloat(document.getElementById('swap-amount-in').value);

  if (!amount || amount <= 0) {
    addLog('스왑할 수량을 입력하세요', 'error');
    return;
  }

  if (!isConnected) {
    addLog('먼저 API에 연결하세요', 'error');
    return;
  }

  // 실시간 잔고 재확인
  addLog('실시간 잔고 확인 중...', 'info');
  await refreshTokenBalances();

  const balance = parseFloat(tokenBalances[fromToken] || 0);
  if (amount > balance) {
    addLog(`❌ 잔고 부족! 현재 ${fromToken} 잔고: ${balance.toFixed(6)}, 필요: ${amount}`, 'error');
    return;
  }

  addLog(`✅ 잔고 확인 완료: ${balance.toFixed(6)} ${fromToken}`, 'success');

  if (!confirm(`${amount} ${fromToken}를 ${toToken}로 스왑하시겠습니까?\n\n현재 잔고: ${balance.toFixed(6)} ${fromToken}`)) {
    return;
  }

  const btn = document.getElementById('execute-swap-btn');
  const originalText = btn.textContent;
  btn.textContent = '⏳ 스왑 중...';
  btn.disabled = true;

  try {
    addLog(`스왑 시작: ${amount} ${fromToken} → ${toToken}`, 'info');

    const result = await ipcRenderer.invoke('execute-swap', {
      fromToken,
      toToken,
      amount
    });

    if (result.success) {
      const data = result.data;
      addLog(`✅ 스왑 성공!`, 'success');
      addLog(`받은 수량: ${parseFloat(data.amountOut).toFixed(6)} ${toToken}`, 'success');
      addLog(`Price Impact: ${(data.priceImpact * 100).toFixed(4)}%`, 'info');
      addLog(`TX: ${data.explorerUrl}`, 'info');

      // 스왑 내역 추가
      const swapHistory = document.getElementById('swap-history');
      const emptyState = swapHistory.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      const historyItem = document.createElement('div');
      historyItem.className = 'swap-result-item';
      historyItem.innerHTML = `
        <div class="timestamp">${new Date().toLocaleString('ko-KR')}</div>
        <div>✅ ${amount} ${fromToken} → ${parseFloat(data.amountOut).toFixed(6)} ${toToken}</div>
        <div>Price Impact: ${(data.priceImpact * 100).toFixed(4)}%</div>
        <div><a href="${data.explorerUrl}" target="_blank">BSCScan에서 보기</a></div>
      `;
      swapHistory.insertBefore(historyItem, swapHistory.firstChild);

      // 입력 초기화
      document.getElementById('swap-amount-in').value = '';
      document.getElementById('swap-amount-out').value = '';
      document.getElementById('swap-info').style.display = 'none';

      // 잔고 새로고침
      await refreshTokenBalances();
      await refreshBalance();
    }
  } catch (error) {
    addLog(`❌ 스왑 실패: ${error.message}`, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});

// 레버리지 적용
document.getElementById('apply-leverage').addEventListener('click', async () => {
  const symbol = document.getElementById('trade-symbol').value;
  const leverage = parseInt(document.getElementById('trade-leverage').value);

  if (leverage < 1 || leverage > 20) {
    addLog('레버리지는 1-20배 사이여야 합니다', 'error');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('change-leverage', { symbol, leverage });
    if (result.success) {
      addLog(`레버리지 변경 완료: ${symbol} ${leverage}x`, 'success');
    }
  } catch (error) {
    addLog(`레버리지 변경 실패: ${error.message}`, 'error');
  }
});

// 수동 거래
document.getElementById('manual-order-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const orderData = {
    symbol: document.getElementById('trade-symbol').value,
    side: document.getElementById('trade-side').value,
    type: document.getElementById('trade-type').value,
    size: parseFloat(document.getElementById('trade-size').value)
  };

  if (orderData.type === 'limit') {
    orderData.price = parseFloat(document.getElementById('trade-price').value);
  }

  try {
    const result = await ipcRenderer.invoke('place-order', orderData);
    if (result.success) {
      addLog(`주문 성공: ${orderData.side} ${orderData.size} ${orderData.symbol}`, 'success');
      await refreshOrders();
      await refreshPositions();
    }
  } catch (error) {
    addLog(`주문 실패: ${error.message}`, 'error');
  }
});

// 주문 타입 변경
document.getElementById('trade-type').addEventListener('change', (e) => {
  const priceGroup = document.getElementById('price-group');
  if (e.target.value === 'market') {
    priceGroup.style.display = 'none';
  } else {
    priceGroup.style.display = 'flex';
  }
});

// 티커 새로고침
document.getElementById('refresh-ticker').addEventListener('click', async () => {
  const symbol = document.getElementById('trade-symbol').value;

  try {
    const result = await ipcRenderer.invoke('get-ticker', symbol);
    if (result.success) {
      const ticker = result.data;
      document.getElementById('ticker-last').textContent = ticker.last_price || '-';
      document.getElementById('ticker-mark').textContent = ticker.mark_price || '-';
      document.getElementById('ticker-index').textContent = ticker.index_price || '-';
      document.getElementById('ticker-volume').textContent = '-';

      addLog(`티커 업데이트: ${symbol}`, 'info');
    }
  } catch (error) {
    addLog(`티커 조회 실패: ${error.message}`, 'error');
  }
});

// 자동 새로고침
function startAutoRefresh() {
  if (autoRefreshInterval) return;

  autoRefreshInterval = setInterval(async () => {
    await refreshBalance();
    await refreshPositions();
    await refreshOrders();

    // 포지션 관리 탭이 활성화되어 있으면 상세 정보도 새로고침
    const positionsTab = document.getElementById('positions');
    if (positionsTab.classList.contains('active')) {
      await refreshPositionsDetail();
    }

    // 토큰 스왑 탭이 활성화되어 있으면 토큰 잔고도 새로고침
    const swapTab = document.getElementById('token-swap');
    if (swapTab.classList.contains('active')) {
      await refreshTokenBalances();
    }
  }, 10000);

  addLog('자동 새로고침 시작', 'info');
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    addLog('자동 새로고침 중지', 'info');
  }
}

// 봇 상태 모니터링
function startBotStatusMonitoring() {
  if (botStatusInterval) return;
  botStatusInterval = setInterval(updateBotStatus, 2000);
}

function stopBotStatusMonitoring() {
  if (botStatusInterval) {
    clearInterval(botStatusInterval);
    botStatusInterval = null;
  }
}

// 자동 새로고침 토글
document.getElementById('auto-refresh').addEventListener('change', (e) => {
  if (e.target.checked && isConnected) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

// 저장 설정 토글
document.getElementById('save-credentials').addEventListener('change', (e) => {
  if (!e.target.checked) {
    clearSavedCredentials();
    addLog('저장된 로그인 정보가 삭제되었습니다', 'info');
  }
});

// 초기 로그
addLog('STANDX Trading Bot 시작', 'info');
addLog('설정 탭에서 지갑으로 인증하세요', 'info');
