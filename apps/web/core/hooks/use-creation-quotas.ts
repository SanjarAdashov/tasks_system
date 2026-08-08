import useSWR from "swr";
import { UserService } from "@/services/user.service";

const userService = new UserService();

export const useCreationQuotas = () =>
  useSWR("CURRENT_USER_CREATION_QUOTAS", () => userService.currentUserCreationQuotas(), {
    revalidateOnFocus: true,
  });
