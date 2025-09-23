// import React from 'react';

// interface ErrorBoundaryState {
//   hasError: boolean;
//   error?: Error;
// }

// interface ErrorBoundaryProps {
//   children: React.ReactNode;
//   fallback?: React.ReactNode;
// }

// export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
//   constructor(props: ErrorBoundaryProps) {
//     super(props);
//     this.state = { hasError: false };
//   }

//   static getDerivedStateFromError(error: Error): ErrorBoundaryState {
//     return { hasError: true, error };
//   }

//   componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
//     console.error('ErrorBoundary caught an error:', error, errorInfo);
//   }

//   render() {
//     if (this.state.hasError) {
//       return this.props.fallback || (
//         <div className="error-boundary">
//           <h3>Something went wrong</h3>
//           <p>An error occurred while rendering this component.</p>
//           {this.state.error && (
//             <details>
//               <summary>Error details</summary>
//               <pre>{this.state.error.toString()}</pre>
//             </details>
//           )}
//         </div>
//       );
//     }

//     return this.props.children;
//   }
// }