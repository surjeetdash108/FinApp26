import { IQShell } from "../iq/shell";
import { RequestsScreen } from "../iq/screens/requests";

export default function RequestsPage() {
  return (
    <IQShell>
      <RequestsScreen />
    </IQShell>
  );
}
