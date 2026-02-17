import repository from "@pontalti/repository/work-hour";
import employeeRepository from "@pontalti/repository/employee"
import { WorkHourFilters } from "@pontalti/types/work-hour.types";
import { User } from "@pontalti/types/user.types";

const calculateHoursWorked = (registros: { clock_in: Date; clock_out: Date }[]) => {
  const groupedByDate = registros.reduce((acc, curr) => {
    const dateKey = curr.clock_in.toISOString().split('T')[0];
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(curr);
    return acc;
  }, {} as Record<string, { clock_in: Date; clock_out: Date }[]>);

  const resultado = Object.keys(groupedByDate).map(date => {
    const dayWorkHours = groupedByDate[date];
    const firstClockIn = dayWorkHours[0].clock_in;
    const lastClockOut = dayWorkHours[dayWorkHours.length - 1].clock_out;

    if (!lastClockOut) {
      return {
        primeiroPonto: firstClockIn,
        ultimoPonto: "Sem ponto de saída",
        totalHoras: 'Não é possível calcular',
      };
    }

    const totalHoursWorkedMs = dayWorkHours.reduce((acc, curr) => {
      return acc + (curr.clock_out.getTime() - curr.clock_in.getTime());
    }, 0);

    const totalHours = Math.floor(totalHoursWorkedMs / (1000 * 60 * 60));
    const totalMinutes = Math.floor((totalHoursWorkedMs % (1000 * 60 * 60)) / (1000 * 60));
    const totalHoras = `${totalHours}:${totalMinutes.toString().padStart(2, '0')}`;

    return {
      primeiroPonto: firstClockIn,
      ultimoPonto: lastClockOut,
      totalHoras: totalHoras,
    };
  });

  return resultado;
};

const createWorkHour = async (user: Omit<User, "password">, datetime?: Date) => {
  try {
    const time = datetime ? datetime : new Date()
    const employee = await employeeRepository.getEmployeeByEmail(user.email);
    if (!employee) throw new Error();
    const workHours = await repository.getTodayEmployeeWorkHour(employee.id);
    if (workHours.length >= 1) {
      const lastWorkHour = workHours[0]
      const response = lastWorkHour.clock_out ?
        await repository.createEmployeeWorkHour({ employee_id: employee.id, clock_in: time })
        : updatePartialEmployeeWorkHour(lastWorkHour.id, { clock_out: time });
      return response
    }
    return await repository.createEmployeeWorkHour({ employee_id: employee.id, clock_in: time });
  } catch (e) {
    throw e
  }
};

const getWorkHours = async (filters: WorkHourFilters) => {
  return calculateHoursWorked(await repository.getEmployeesWorkHours(filters));
};

const getEmployeeWorkHourById = async (id: number) => {
  return await repository.getEmployeeWorkHour(id);
};

const getEmployeeWorkHourByDay = async (day: Date, employee_id: number) => {
  return await repository.getEmployeesWorkHours({ employee_id, startDate: day, endDate: day })
}

const getAllWorkHoursToday = async () => {
  const workHours = await repository.getTodayWorkHour()

  const groupedByEmployee = workHours.reduce((acc, workHour) => {
    const employeeId = workHour.employee_id;
    if (!acc[employeeId]) {
      acc[employeeId] = {
        employe_id: workHour.employee_id,
        workHours: [],
      };
    }
    acc[employeeId].workHours.push(workHour);
    return acc;
  }, {});

  return workHours;

}

const updatePartialEmployeeWorkHour = async (id: number, data: unknown) => {
  return await repository.updatePartialEmployeeWorkHour(id, data);
};

const deleteEmployeeWorkHour = async (id: number) => {
  return await repository.deleteEmployeeWorkHour(id);
};

const getWorkHoursReport = async (startDate: Date, endDate: Date, employeeId?: number) => {
  return await repository.getWorkHoursReport(startDate, endDate, employeeId);
};

export default {
  createWorkHour,
  getWorkHours,
  getEmployeeWorkHourById,
  getEmployeeWorkHourByDay,
  getAllWorkHoursToday,
  updatePartialEmployeeWorkHour,
  deleteEmployeeWorkHour,
  getWorkHoursReport
};

