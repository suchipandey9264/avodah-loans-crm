import { Component } from "react";
import { Alert, Button } from "./ui";

/** Keeps a crash inside one page from blanking the whole app. Resets when `resetKey` (the URL) changes. */
export default class ErrorBoundary extends Component {
  state = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error) {
    return { error };
  }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  componentDidCatch(error, info) {
    console.error(error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert>
        Something went wrong on this page.{" "}
        <Button variant="secondary" size="sm" className="ml-2 align-middle" onClick={() => this.setState({ error: null })}>Try again</Button>
      </Alert>
    );
  }
}
