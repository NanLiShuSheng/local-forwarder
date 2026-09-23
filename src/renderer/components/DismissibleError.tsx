interface DismissibleErrorProps {
  message: string;
  onClose: () => void;
}

export function DismissibleError({ message, onClose }: DismissibleErrorProps) {
  return <div className="error-box" role="alert"><span className="error-message">{message}</span><button type="button" className="error-dismiss" aria-label="关闭错误提示" onClick={onClose}>×</button></div>;
}
