import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', errorInfo: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || '알 수 없는 오류가 발생했습니다.',
    };
  }

  componentDidCatch(error, info) {
    const context = {
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    };

    console.groupCollapsed('[ErrorBoundary] 렌더링 크래시');
    console.error('오류 메시지:', error?.message);

    if (error?.message?.includes('선택지는 최소')) {
      console.error(
        '원인 추정: 선택형 질문(객관식·체크박스·드롭다운)의 options 배열이 2개 미만인 상태에서 ' +
        'sanitizeSurveyQuestions(strict:true)가 렌더링 경로에서 호출되었습니다.',
      );
      console.error(
        '해결: useMemo 또는 렌더링 경로에서 sanitizeSurveyQuestions를 호출할 때 ' +
        '{ strict: false } 옵션을 사용하세요.',
      );
    }

    console.error('스택:', error?.stack);
    console.error('컴포넌트 트리:', info?.componentStack);
    console.groupEnd();

    this.setState({ errorInfo: context });
  }

  handleReset() {
    this.setState({ hasError: false, message: '', errorInfo: null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-shell">
          <div className="fatal-error">
            <h1>화면을 불러오지 못했습니다.</h1>
            <p>{this.state.message}</p>
            <p>
              브라우저 콘솔(F12)에서 <code>[ErrorBoundary]</code> 항목을 확인하면
              상세 원인을 볼 수 있습니다.
            </p>
            <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                className="primary-button"
                onClick={this.handleReset}
                type="button"
              >
                다시 시도
              </button>
              <button
                className="secondary-button"
                onClick={() => window.location.reload()}
                type="button"
              >
                페이지 새로고침
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
