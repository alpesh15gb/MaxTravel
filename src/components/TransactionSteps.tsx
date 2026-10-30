import Icon from "./Icon";
export default function TransactionSteps({ labels, current }: { labels: readonly string[]; current: number }) {
  return <ol className="transaction-stepper" aria-label="Transaction progress">{labels.map((label,index)=><li key={label} aria-current={current===index?"step":undefined} className={index<current?"is-complete":""}><span>{index<current?<Icon name="check" size={16}/>:index+1}</span>{label}</li>)}</ol>;
}
