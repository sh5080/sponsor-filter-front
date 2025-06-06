import { useEffect, useState } from 'react';
import { useSearchStore } from '@/store/search.store';
import { searchApi } from '@/apis/search.api';

// 기본 페이지당 항목 수 (API 요청 및 UI에 표시할 항목 수)
const itemsPerPage = 10;
// 한 번에 프리페치할 페이지 수
const PREFETCH_COUNT = 1;

export const useSearch = () => {
  const {
    query,
    results,
    isLoading,
    error,
    hasSearched,
    currentPage,
    setQuery,
    setLoading,
    setError,
    setResults,
    resetSearch,
    getCachedResults,
    setPendingFetch,
    removePendingFetch,
    getPendingFetch,
    setCurrentPage,
    isFromMainNavigation,
    setFromMainNavigation,
  } = useSearchStore();

  // 네비게이션에서 온 검색인지 확인하는 상태
  const [isFromNavigation, setIsFromNavigation] = useState<boolean>(isFromMainNavigation);

  // 컴포넌트 마운트 시 확인
  useEffect(() => {
    // 브라우저 환경에서만 실행
    if (typeof window !== 'undefined') {
      // referrer가 있고 같은 도메인이면서 /search가 아니면 네비게이션에서 온 것
      const referrer = document.referrer;
      const currentHost = window.location.host;
      const isFromMainPage = referrer.includes(currentHost) && !referrer.includes('/search');

      setIsFromNavigation(isFromMainPage);
      setFromMainNavigation(isFromMainPage); // 스토어 상태도 업데이트
      console.log('네비게이션에서 검색 페이지로 이동:', isFromMainPage);
    }
  }, [setFromMainNavigation]);

  // 컴포넌트 마운트 시 캐시된 결과 복원
  useEffect(() => {
    // 컴포넌트 마운트 시 한 번만 실행되어야 함
    const restoreCachedResults = () => {
      // 메인 페이지에서 넘어온 경우 캐시를 복원하지 않음
      if (isFromNavigation) {
        console.log('메인 페이지에서 이동: 캐시 복원 건너뜀');
        return;
      }

      // 이전에 검색했던 기록이 있는 경우
      if (hasSearched && query) {
        // 이미 결과가 있는 경우 스킵 (이미 스토어에서 초기화된 경우)
        if (results) {
          return;
        }

        // 로딩 상태 설정 (스토어에서 설정되지 않았을 경우를 대비)
        if (!isLoading) {
          setLoading(true);
        }

        // 캐시된 결과 확인
        const cachedResult = getCachedResults(query, currentPage);
        if (cachedResult) {
          // 결과 복원 - 약간의 딜레이를 주어 로딩 UI가 표시되도록 함
          setTimeout(() => {
            setResults(cachedResult);
            setLoading(false);
          }, 500); // 500ms 딜레이
        } else {
          setLoading(false);
        }
      }
    };

    restoreCachedResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFromNavigation]); // isFromNavigation이 바뀔 때도 실행

  // 검색 처리 함수
  const handleSearch = async (searchQuery?: string, page: number = 1) => {
    const currentQuery = searchQuery !== undefined ? searchQuery : query;

    // 검색어가 없으면 검색하지 않음
    if (!currentQuery.trim()) {
      setError('검색어를 입력해주세요.');
      return;
    }

    // 메인 페이지에서 넘어온 경우 로딩 상태만 보여주고 이전 결과는 숨김
    if (isFromNavigation && searchQuery) {
      console.log('메인 페이지에서 이동한 검색: 캐시를 사용하지 않고 새로 검색합니다');
      // 로딩 상태 설정
      setLoading(true);
      setError(null);
      setQuery(currentQuery);

      try {
        // API 호출
        console.log(`'${currentQuery}' 새로 검색 중... (페이지 ${page}, ${itemsPerPage}개 항목)`);
        const searchResults = await searchApi.searchBlogs({
          query: currentQuery,
          offset: (page - 1) * itemsPerPage,
          limit: itemsPerPage,
        });

        // 결과 저장
        setResults(searchResults);
        setCurrentPage(page);

        // 다음 페이지 프리페치 (백그라운드)
        prefetchNextPage(currentQuery, page);
      } catch (err) {
        setLoading(false);
        setError('검색 중 오류가 발생했습니다. 다시 시도해주세요.');
        console.error('검색 오류:', err);
      }
      return;
    }

    // 이미 같은 쿼리로 같은 페이지를 보고 있는 경우 중복 호출 방지
    if (results && results.keyword === currentQuery && results.page === page && !isLoading) {
      console.log(`이미 '${currentQuery}' 페이지 ${page}를 보고 있습니다. 중복 호출 방지.`);
      return;
    }

    // 페이지 번호가 변경된 경우 (페이지네이션 클릭)
    if (currentQuery === query) {
      // 캐시된 결과가 있는지 확인
      const cachedResults = getCachedResults(currentQuery, page);
      if (cachedResults) {
        console.log(`캐시된 결과 사용 (페이지 ${page})`);
        setResults(cachedResults);
        setCurrentPage(page);

        // 다음 페이지 프리페치 (백그라운드)
        prefetchNextPage(currentQuery, page);
        return;
      }

      // 진행 중인 프리페치 요청이 있는지 확인
      const pendingPromise = getPendingFetch(page);
      if (pendingPromise) {
        console.log(`페이지 ${page}에 대한 프리페치가 진행 중입니다. 기다리는 중...`);

        try {
          // 로딩 상태 설정
          setLoading(true);

          // 진행 중인 프리페치 요청이 완료될 때까지 대기
          const results = await pendingPromise;

          // 결과 설정
          setResults(results);
          setCurrentPage(page);

          // 다음 페이지 프리페치
          prefetchNextPage(currentQuery, page);
          return;
        } catch (err) {
          // 프리페치 요청이 실패한 경우, 일반 API 호출로 진행
          console.error('프리페치 요청 대기 중 오류 발생:', err);
          // 아래의 일반 API 호출 로직으로 진행됨
        }
      }
    }

    try {
      // 새 검색어 또는 캐시된 결과가 없으면 API 호출
      setLoading(true);
      setError(null);

      if (searchQuery !== undefined) {
        setQuery(currentQuery);
      }

      // API 호출
      console.log(`'${currentQuery}' 검색 중... (페이지 ${page}, ${itemsPerPage}개 항목)`);
      const searchResults = await searchApi.searchBlogs({
        query: currentQuery,
        offset: (page - 1) * itemsPerPage,
        limit: itemsPerPage,
      });
      // 결과 저장
      setResults(searchResults);
      setCurrentPage(page);

      // 다음 페이지 프리페치 (백그라운드)
      prefetchNextPage(currentQuery, page);
    } catch (err) {
      setLoading(false);
      setError('검색 중 오류가 발생했습니다. 다시 시도해주세요.');
      console.error('검색 오류:', err);
    }
  };

  // 다음 페이지 프리페치 (백그라운드 작업)
  const prefetchNextPage = async (queryText: string, currentPage: number) => {
    // 프리페치할 페이지들
    const pagesToFetch = [];
    for (let i = 1; i <= PREFETCH_COUNT; i++) {
      pagesToFetch.push(currentPage + i);
    }

    // 비동기로 다음 페이지들 가져오기
    for (const nextPage of pagesToFetch) {
      try {
        // 이미 캐시에 있는지 확인
        const cached = getCachedResults(queryText, nextPage);
        if (cached) continue;

        // 이미 프리페치 중인지 확인
        const pendingPromise = getPendingFetch(nextPage);
        if (pendingPromise) {
          console.log(`페이지 ${nextPage}는 이미 프리페치 중입니다.`);
          continue;
        }

        // 백그라운드에서 다음 페이지 데이터 가져오기
        console.log(`백그라운드에서 페이지 ${nextPage} 가져오는 중...`);

        // 이 함수를 사용하여 실제 API 호출 및 캐싱 처리
        const fetchAndCachePage = async (page: number) => {
          const nextPageData = await searchApi.searchBlogs({
            query: queryText,
            offset: (page - 1) * itemsPerPage,
            limit: itemsPerPage,
          });

          // 스토어에 결과 캐싱 (현재 표시된 결과는 변경하지 않음)
          if (nextPageData && nextPageData.posts.length > 0) {
            // 직접 캐시에 저장하지만 화면은 업데이트하지 않음
            const { cachedResults } = useSearchStore.getState();
            const cacheKey = queryText.toLowerCase().trim();

            // 기존 캐시 확인
            const existingCache = cachedResults[cacheKey] || {
              keywordData: {
                totalResults: nextPageData.totalResults,
                itemsPerPage: nextPageData.itemsPerPage,
                timestamp: Date.now(),
              },
              pageData: {},
            };

            // 새 페이지 데이터 추가
            const updatedPageData = { ...existingCache.pageData };
            updatedPageData[page] = {
              sponsoredResults: nextPageData.sponsoredResults,
              posts: nextPageData.posts,
            };

            // 캐시 업데이트 (setResults 대신 상태만 직접 업데이트)
            useSearchStore.setState({
              cachedResults: {
                ...cachedResults,
                [cacheKey]: {
                  keywordData: {
                    ...existingCache.keywordData,
                    totalResults: nextPageData.totalResults, // 총 결과수 업데이트
                    timestamp: Date.now(),
                  },
                  pageData: updatedPageData,
                },
              },
            });
          }

          // 작업 완료 후 Map에서 제거
          removePendingFetch(page);
          console.log(`페이지 ${page} 프리페치 완료되었습니다.`);
          return nextPageData;
        };

        // 진행 중인 요청 Map에 저장하고 실행
        const promise = fetchAndCachePage(nextPage);
        setPendingFetch(nextPage, promise);

        // 이 값은 사용하지 않지만, promise를 실행시키기 위해 필요함
        promise.catch(error => {
          console.error(`페이지 ${nextPage} 프리페치 실패:`, error);
          removePendingFetch(nextPage);
        });
      } catch (error) {
        // 프리페치는 실패해도 사용자에게 오류를 표시하지 않음
        console.error(`페이지 ${nextPage} 프리페치 실패:`, error);
      }
    }

    // 맵은 이미 전역으로 참조되므로 다시 할당할 필요 없음
  };

  return {
    query,
    results,
    isLoading,
    error,
    hasSearched,
    currentPage,
    itemsPerPage: itemsPerPage,
    setQuery,
    handleSearch,
    resetSearch,
    setCurrentPage,
    isFromNavigation,
  };
};
