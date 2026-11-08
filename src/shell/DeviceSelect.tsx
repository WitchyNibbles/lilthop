import { useApp, useMicContext } from "../app/appContext";
import { Select } from "./Select";

export function DeviceSelect() {
  const { t } = useApp();
  const mic = useMicContext();
  return (
    <Select
      disabled={mic.status === "starting"}
      label={t("settings.inputDevice")}
      onChange={(value) => mic.chooseDevice(value === "" ? null : value)}
      showLabel
      value={mic.device ?? ""}
    >
      <option value="">{t("common.default")}</option>
      {mic.devices.map((device) => (
        <option key={device} value={device}>
          {device}
        </option>
      ))}
    </Select>
  );
}
