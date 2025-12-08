package middleware

import (
	"strconv"
	"testing"
	"time"
)

// resetState 清理全局状态，避免测试之间相互影响
func resetState() {
	mu.Lock()
	defer mu.Unlock()
	ipRateLimiters = make(map[string]*ipLimiterEntry)
	lastCleanup = time.Time{}
}

// getEntry 无锁读取（仅用于断言前快速访问），调用方需在持锁区域内使用
func getEntry(ip string) *ipLimiterEntry {
	return ipRateLimiters[ip]
}

func TestLazyCleanupTTLRemovesExpiredEntries(t *testing.T) {
	resetState()

	// 创建两个IP：一个过期，一个活跃
	now := time.Now()
	GetIPRateLimiter("expired")
	GetIPRateLimiter("active")

	mu.Lock()
	// 让 expired 变为过期（lastSeen 超过 TTL）
	if e := getEntry("expired"); e != nil {
		e.lastSeen = now.Add(-(ipLimiterTTL + time.Second))
	} else {
		mu.Unlock()
		t.Fatalf("expected 'expired' entry to exist")
	}
	// active 设为当前
	if a := getEntry("active"); a != nil {
		a.lastSeen = now
	} else {
		mu.Unlock()
		t.Fatalf("expected 'active' entry to exist")
	}
	// 上次清理设为很久以前，确保触发清理
	lastCleanup = now.Add(-time.Hour)
	mu.Unlock()

	// 触发惰性清理：任意获取一个限流器即可
	_ = GetIPRateLimiter("trigger")

	// 验证：expired 被删除，active 与 trigger 保留
	mu.Lock()
	defer mu.Unlock()
	if _, ok := ipRateLimiters["expired"]; ok {
		t.Fatalf("expected 'expired' to be cleaned up, but still present")
	}
	if _, ok := ipRateLimiters["active"]; !ok {
		t.Fatalf("expected 'active' to remain, but missing")
	}
	if _, ok := ipRateLimiters["trigger"]; !ok {
		t.Fatalf("expected 'trigger' to be created, but missing")
	}
}

func TestCleanupIntervalPreventsFrequentScans(t *testing.T) {
	resetState()
	now := time.Now()
	GetIPRateLimiter("expired")

	mu.Lock()
	if e := getEntry("expired"); e != nil {
		e.lastSeen = now.Add(-(ipLimiterTTL + time.Second))
	} else {
		mu.Unlock()
		t.Fatalf("expected 'expired' entry to exist")
	}
	// 设置上次清理为刚刚，清理间隔未到
	lastCleanup = now
	mu.Unlock()

	// 触发一次获取，不应清理（因为 cleanupInterval 未到）
	_ = GetIPRateLimiter("trigger1")

	mu.Lock()
	if _, ok := ipRateLimiters["expired"]; !ok {
		mu.Unlock()
		t.Fatalf("expected 'expired' NOT to be cleaned due to cleanupInterval, but it was removed")
	}
	// 强制让上次清理时间过期，以便下一次触发清理
	lastCleanup = now.Add(-(cleanupInterval + time.Second))
	mu.Unlock()

	// 再次触发，此时应进行清理
	_ = GetIPRateLimiter("trigger2")

	mu.Lock()
	defer mu.Unlock()
	if _, ok := ipRateLimiters["expired"]; ok {
		t.Fatalf("expected 'expired' to be cleaned after interval passed, but still present")
	}
}

func TestMaxLimitersThresholdTriggersCleanup(t *testing.T) {
	resetState()
	now := time.Now()

	// 阻止基于时间的清理（让 lastCleanup 处于新鲜状态）
	mu.Lock()
	lastCleanup = now
	mu.Unlock()

	// 构造超出阈值的过期条目
	for i := 0; i < maxLimiters+100; i++ {
		ip := "expired-" + strconv.Itoa(i)
		_ = GetIPRateLimiter(ip)
		mu.Lock()
		if e := getEntry(ip); e != nil {
			e.lastSeen = now.Add(-(ipLimiterTTL + time.Second))
		}
		mu.Unlock()
	}

	// 触发获取，应因为 len > maxLimiters 而执行清理
	_ = GetIPRateLimiter("trigger")

	mu.Lock()
	defer mu.Unlock()
	if len(ipRateLimiters) > maxLimiters+1 { // +1 因为包含 trigger
		t.Fatalf("expected cleanup to reduce map size, size=%d exceeds threshold %d", len(ipRateLimiters), maxLimiters+1)
	}
}
