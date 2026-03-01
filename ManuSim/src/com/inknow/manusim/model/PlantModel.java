package com.inknow.manusim.model;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Vector;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.control.Simulator;

/** Plant is the central object of the plant model. It has pointers for all components in the model (e.g. machines, zones, etc.).
 *
 * @author Rui Neves-Silva
 * @version 2.0 Build 0002 Oct-2019.
 */

public class PlantModel {

	private Simulator parent;
	// Energy related variables
	private double setpointRate;		// setpoint value for current rate for each workarea unit - change with shift
	private double currProductionRate;	// instantaneous value for production rate [parts/min] - all units
	private double currPower;			// instantaneous value for energy consumption [W] - all units
	private double totalRate;			// instantaneous value for % rate of the plant [0 - 1]
	//
	private double cumProduction;		// accumulated number of product parts since beginning
	private double cumEnergy;			// accumulated value since beginning [J]
	private double cumCost;				// accumulated value since beginning [EUR]
	
	private double productEnergy;		// energy consumed per product part [J/part]
	private double productCost;			// cost of energy consumed per product part [EUR/part]
	//
	private int numberAccidents;
	//
	private int currShiftTimeMinutes;	// current count down value to the end of the shift in minutes
	//
	private Vector<Workarea> workareas;
	private Vector<Unit> units;
	private Vector<Actor> actors;
	//
	private DecimalFormatSymbols customDFSymbol;
	private DecimalFormat fmtCurrPower;
	private DecimalFormat fmtCumEnergy;
	private DecimalFormat fmtCumCost;
	private DecimalFormat fmtProductEnergy;
 private DecimalFormat fmtProductCost;
 private DecimalFormat fmtNumberAccidents;
 // events
 private final List<SimulationEventListener> eventListeners = new ArrayList<SimulationEventListener>();
 private double lastCumProductionForEvents = 0.0;
 private int lastAccidentsForEvents = 0;
 // events state tracking
 private final Map<String, String> lastUnitState = new HashMap<String, String>();
 private int currentStepForEvents = -1; // provided by headless runner
	
	// constructor

	public PlantModel() {
		this.parent = null;
		this.currProductionRate = 0.0;
		this.currPower = 0.0;
		this.totalRate = 0.0;
		this.setpointRate = 0.0;
		this.cumProduction = 0.0;
		this.cumEnergy = 0.0;
		this.cumCost = 0.0;
		this.productEnergy = 0.0;
		this.productCost = 0.0;
		this.numberAccidents = 0;
		this.currShiftTimeMinutes = 0;
		this.workareas = new Vector<Workarea>();
		this.units = new Vector<Unit>();
		this.actors = new Vector<Actor>();
		this.customDFSymbol = new DecimalFormatSymbols();
		this.initDecimalFormats();
	}

	public PlantModel( Simulator parent ) {
		this.parent = parent;
		//
		this.currProductionRate = 0.0;
		this.currPower = 0.0;
		this.totalRate = 0.0;
		this.setpointRate = Const.RATE_FULL / 2.0;
		//
		this.cumProduction = 0.0;
		this.cumEnergy = 0.0;
		this.cumCost = 0.0;
		//
		this.productEnergy = 0.0;
		this.productCost = 0.0;
		//
		this.numberAccidents = 0;
		this.currShiftTimeMinutes = 0;
		//
		this.defineWorkareas();
		this.defineUnits();
		this.installUnits2Workareas();
		this.defineActors();		
		this.installActors2Workareas();
		//
		this.initDecimalFormats();
	}

	// other methods

	public void simulateStep( ContextModel contextModel ) {		
		this.currPower = 0.0;
		this.totalRate = 0.0;	
		this.currShiftTimeMinutes += Const.TS_SIM_MINUTES;
		// check if it was the end of the shift
		if ( currShiftTimeMinutes >= Const.SHIFTTIME_MINUTES ) {
			// event: shift end
			fireShiftEvent("SHIFT_END", contextModel);
			// change shift using state-machine and reset shift counter
			for(int i = 0; i < this.actors.size(); i++) {
				this.actors.get(i).simulateStep();
				for (int j = 0; j < this.workareas.size(); j++) {
					if ( this.actors.get(i).getLocationIndex() == this.workareas.get(j).getWorkLocationIndex() ) {
						this.workareas.get(j).setCurrActor( this.actors.get(i) );
					}
				}
			}
			// at the beginning of the next shift the new rate is set and any failed unit is repaired
			for(int i = 0; i < this.workareas.size(); i++) {
				this.workareas.get(i).setCurrRate( this.setpointRate );
				if ( this.workareas.get(i).getStatus() == Const.STATUS_FAILURE ) {
					this.workareas.get(i).setStatus( Const.STATUS_MAINTENANCE );
				}
				if ( this.workareas.get(i).getStatus() == Const.STATUS_ACCIDENT ) {
					this.workareas.get(i).setStatus( Const.STATUS_ON );
				}
			}
			this.currShiftTimeMinutes = 0;	
			// event: shift start
			fireShiftEvent("SHIFT_START", contextModel);
		}
		//		
		this.numberAccidents = 0;
		for (int i=0; i < this.workareas.size(); i++) {
			this.workareas.get(i).simulateStep( contextModel, this.currShiftTimeMinutes );
			//
			this.currPower += this.workareas.get(i).getCurrPower();		
			this.totalRate += this.workareas.get(i).getCurrRate();
			this.numberAccidents += this.workareas.get(i).getNumberAccidents();
		}		
		//		
		this.productEnergy = ( this.totalRate > 0 ? this.currPower / 1000 / this.totalRate : 0.0 );			// kWh/u
		this.productCost = this.productEnergy * Const.EUR_KWH;			// EUR/u
		this.cumEnergy += this.currPower * Const.TS_SIM_MINUTES / 60; 	// Wh
		this.cumCost = this.cumEnergy * Const.EUR_KWH / 1000;			// EUR
		// events: production completed delta (TODO: relies on reliable cumProduction updates)
		double prodDelta = this.cumProduction - this.lastCumProductionForEvents;
		if (prodDelta > 0) {
			ContextModel ctxForProd = (this.parent != null ? this.parent.getContextModel() : null);
			if (ctxForProd != null) {
				Map<String,Object> payload = new HashMap<String,Object>();
				payload.put("quantity", prodDelta);
				payload.put("step", this.currentStepForEvents);
				fireEvent(new SimulationEvent("PRODUCTION_COMPLETED", makeTimestamp(ctxForProd), null, null, payload));
			}
			this.lastCumProductionForEvents = this.cumProduction;
		}
		// events: plant-level accident delta
		if (this.numberAccidents > this.lastAccidentsForEvents) {
			Map<String, Object> payload = new HashMap<String, Object>();
			payload.put("delta", this.numberAccidents - this.lastAccidentsForEvents);
			fireEvent(new SimulationEvent("ACCIDENT_OCCURRED", makeTimestamp(contextModel), null, null, payload));
		}
		this.lastAccidentsForEvents = this.numberAccidents;
	}

    // ========== Events API ==========
    public void addEventListener(SimulationEventListener l) {
        if (l != null && !this.eventListeners.contains(l)) this.eventListeners.add(l);
    }
    public void removeEventListener(SimulationEventListener l) {
        this.eventListeners.remove(l);
    }
    private void fireEvent(SimulationEvent ev) {
        for (int i = 0; i < this.eventListeners.size(); i++) {
            this.eventListeners.get(i).onEvent(ev);
        }
    }
    private void fireShiftEvent(String type, ContextModel ctx) {
        fireEvent(new SimulationEvent(type, makeTimestamp(ctx), null, null, null));
    }
    long makeTimestamp(ContextModel ctx) {
        return (long)ctx.getAuditDay() * 24L * 60L + (long)ctx.getClockMinutes().getDayMinute();
    }
    private String buildUnitId(int workareaId, char unitType, int index) {
        return "WA" + workareaId + "-" + unitType + index;
    }
    private String mapState(int status, double rate) {
        if (status == Const.STATUS_FAILURE) return "FAILURE";
        if (status == Const.STATUS_MAINTENANCE) return "MAINTENANCE";
        // Treat ACCIDENT as FAILURE for state machine simplicity (separate ACCIDENT_OCCURRED event exists)
        if (status == Const.STATUS_ACCIDENT) return "FAILURE";
        // STATUS_ON: decide BUSY/IDLE by rate
        return (rate > 0.0 ? "BUSY" : "IDLE");
    }
    public void notifyWorkareaStatusChanged(Workarea wa) {
        ContextModel ctx = (this.parent != null ? this.parent.getContextModel() : null);
        if (ctx == null) return;
        String newState = mapState(wa.getStatus(), wa.getCurrRate());
        int wid = wa.getId();
        long ts = makeTimestamp(ctx);
        fireUnitStateIfChanged(wid, 'A', 1, newState, ts);
        fireUnitStateIfChanged(wid, 'B', 1, newState, ts);
        fireUnitStateIfChanged(wid, 'C', 1, newState, ts);
    }
    public void notifyWorkareaRateChanged(Workarea wa) {
        ContextModel ctx = (this.parent != null ? this.parent.getContextModel() : null);
        if (ctx == null) return;
        String newState = mapState(wa.getStatus(), wa.getCurrRate());
        int wid = wa.getId();
        long ts = makeTimestamp(ctx);
        fireUnitStateIfChanged(wid, 'A', 1, newState, ts);
        fireUnitStateIfChanged(wid, 'B', 1, newState, ts);
        fireUnitStateIfChanged(wid, 'C', 1, newState, ts);
    }
    public void notifyAccidentOccurredInWorkarea(Workarea wa, int delta) {
        ContextModel ctx = (this.parent != null ? this.parent.getContextModel() : null);
        if (ctx == null) return;
        Map<String,Object> payload = new HashMap<String,Object>();
        payload.put("delta", delta);
        payload.put("step", this.currentStepForEvents);
        fireEvent(new SimulationEvent("ACCIDENT_OCCURRED", makeTimestamp(ctx), wa.getId(), null, payload));
    }

    private void fireUnitStateIfChanged(int workareaId, char unitType, int index, String newState, long ts) {
        String uid = buildUnitId(workareaId, unitType, index);
        String prev = this.lastUnitState.get(uid);
        if (prev == null || !prev.equals(newState)) {
            Map<String,Object> payload = new HashMap<String,Object>();
            payload.put("prevState", prev);
            payload.put("newState", newState);
            payload.put("step", this.currentStepForEvents);
            this.lastUnitState.put(uid, newState);
            fireEvent(new SimulationEvent("UNIT_STATE_CHANGED", ts, workareaId, uid, payload));
        }
    }

    /** Provided by the headless runner before each simulate step to include step in events. */
    public void setCurrentStepForEvents(int step) { this.currentStepForEvents = step; }
	
	public void initUnitsTechnology() {
		for(int i=0; i < this.units.size(); i++) {
			switch( this.units.get(i).getType() ){
			case Const.UNIT_A1:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(1) );
				break;
			case Const.UNIT_A2:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(2) );
				break;
			case Const.UNIT_A3:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(3) );
				break;
			case Const.UNIT_B1:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(1) );
				break;
			case Const.UNIT_B2:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(2) );
				break;
			case Const.UNIT_B3:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(3) );
				break;
			case Const.UNIT_C1:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(1) );
				break;
			case Const.UNIT_C2:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(2) );
				break;
			case Const.UNIT_C3:
				this.units.get(i).setTechnology( this.parent.getParent().getSetupActors().getExpertiseStdModels().get(3) );
				break;
			default:	
			}
		}
		return;
	}

	public void updateUnitsCurveModels() {
		for(int i=0; i < this.units.size(); i++) {
			switch( this.units.get(i).getType() ){
			case Const.UNIT_A1:
				this.units.get(i).setPowerRateCurve( this.parent.getParent().getSetupUnits().getUnitAPowerRateModels().get(0) );
				this.units.get(i).setEfficiencyRawCurve( this.parent.getParent().getSetupUnits().getUnitAefficiencyRawModels().get(0) );
				break;
			case Const.UNIT_A2:
				this.units.get(i).setPowerRateCurve( this.parent.getParent().getSetupUnits().getUnitAPowerRateModels().get(1) );
				this.units.get(i).setEfficiencyRawCurve(this.parent.getParent().getSetupUnits().getUnitAefficiencyRawModels().get(1) );
				break;
			case Const.UNIT_A3:
				this.units.get(i).setPowerRateCurve(this.parent.getParent().getSetupUnits().getUnitAPowerRateModels().get(2) );
				this.units.get(i).setEfficiencyRawCurve( this.parent.getParent().getSetupUnits().getUnitAefficiencyRawModels().get(2) );
				break;
			case Const.UNIT_B1:
				this.units.get(i).setEfficiencyExpertiseCurve( this.parent.getParent().getSetupUnits().getUnitBefficiencyExpertiseModels().get(0) );
				this.units.get(i).setSafetyExpertiseCurve( this.parent.getParent().getSetupActors().getActorSafetyExpertiseModel() );
				this.units.get(i).setSafetyLightCurve( this.parent.getParent().getSetupActors().getActorSafetyLightModel() );
				this.units.get(i).setSafetyShifttimeCurve( this.parent.getParent().getSetupActors().getActorSafetyShifttimeModel() );
				this.units.get(i).setSafetyRateCurve( this.parent.getParent().getSetupActors().getActorSafetyRateModel() );
				break;
			case Const.UNIT_B2:
				this.units.get(i).setEfficiencyExpertiseCurve( this.parent.getParent().getSetupUnits().getUnitBefficiencyExpertiseModels().get(1) );
				this.units.get(i).setSafetyExpertiseCurve( this.parent.getParent().getSetupActors().getActorSafetyExpertiseModel() );
				this.units.get(i).setSafetyLightCurve( this.parent.getParent().getSetupActors().getActorSafetyLightModel() );
				this.units.get(i).setSafetyShifttimeCurve( this.parent.getParent().getSetupActors().getActorSafetyShifttimeModel() );
				this.units.get(i).setSafetyRateCurve( this.parent.getParent().getSetupActors().getActorSafetyRateModel() );
				break;
			case Const.UNIT_B3:
				this.units.get(i).setEfficiencyExpertiseCurve( this.parent.getParent().getSetupUnits().getUnitBefficiencyExpertiseModels().get(2) );
				this.units.get(i).setSafetyExpertiseCurve( this.parent.getParent().getSetupActors().getActorSafetyExpertiseModel() );
				this.units.get(i).setSafetyLightCurve( this.parent.getParent().getSetupActors().getActorSafetyLightModel() );
				this.units.get(i).setSafetyShifttimeCurve( this.parent.getParent().getSetupActors().getActorSafetyShifttimeModel() );
				this.units.get(i).setSafetyRateCurve( this.parent.getParent().getSetupActors().getActorSafetyRateModel() );
				break;
			case Const.UNIT_C1:
				this.units.get(i).setEfficiencyTemperatureCurve( this.parent.getParent().getSetupUnits().getUnitCefficiencyTemperatureModels().get(0) );
				this.units.get(i).setPowerRateCurve( this.parent.getParent().getSetupUnits().getUnitAPowerRateModels().get(0) );
				this.units.get(i).setWearRawCurve( this.parent.getParent().getSetupUnits().getUnitCwearRawModels().get(0) );
				this.units.get(i).setWearExpertiseCurve( this.parent.getParent().getSetupUnits().getUnitCwearExpertiseModels().get(0) );
				break;
			case Const.UNIT_C2:
				this.units.get(i).setEfficiencyTemperatureCurve( this.parent.getParent().getSetupUnits().getUnitCefficiencyTemperatureModels().get(1) );
				this.units.get(i).setPowerRateCurve( this.parent.getParent().getSetupUnits().getUnitAPowerRateModels().get(1) );
				this.units.get(i).setWearRawCurve( this.parent.getParent().getSetupUnits().getUnitCwearRawModels().get(1) );
				this.units.get(i).setWearExpertiseCurve( this.parent.getParent().getSetupUnits().getUnitCwearExpertiseModels().get(1) );
				break;
			case Const.UNIT_C3:
				this.units.get(i).setEfficiencyTemperatureCurve( this.parent.getParent().getSetupUnits().getUnitCefficiencyTemperatureModels().get(2) );
				this.units.get(i).setPowerRateCurve( this.parent.getParent().getSetupUnits().getUnitAPowerRateModels().get(2) );
				this.units.get(i).setWearRawCurve( this.parent.getParent().getSetupUnits().getUnitCwearRawModels().get(2) );
				this.units.get(i).setWearExpertiseCurve( this.parent.getParent().getSetupUnits().getUnitCwearExpertiseModels().get(2) );
				break;
			default:	
			}
		}
		return;
	}

	public void updateExpertiseModels() {
		for(int i=0; i < this.actors.size(); i++) {
			switch( this.actors.get(i).getType() ){
			case Const.ACTOR_TYPE_A:
				this.actors.get(i).setExpertise( this.parent.getParent().getSetupActors().getActorsExpertModels().get(0) );
				break;
			case Const.ACTOR_TYPE_B:
				this.actors.get(i).setExpertise( this.parent.getParent().getSetupActors().getActorsExpertModels().get(1) );
				break;
			case Const.ACTOR_TYPE_C:
				this.actors.get(i).setExpertise(this.parent.getParent().getSetupActors().getActorsExpertModels().get(2) );
				break;
			case Const.ACTOR_TYPE_D:
				this.actors.get(i).setExpertise( this.parent.getParent().getSetupActors().getActorsExpertModels().get(3) );
				break;
			default:
				this.actors.get(i).setExpertise(this.parent.getParent().getSetupActors().getActorsExpertModels().get(0) );
				break;		
			}
		}
	}
	
	// init decimal formats
	private void initDecimalFormats() {
		this.customDFSymbol = new DecimalFormatSymbols();
		this.customDFSymbol.setGroupingSeparator(' ');
		
		this.fmtCurrPower = new DecimalFormat("#,##0.0 kW");
		this.fmtCurrPower.setDecimalFormatSymbols(customDFSymbol);
		
		this.fmtCumEnergy = new DecimalFormat("#,##0.0 kWh");
		this.fmtCumEnergy.setDecimalFormatSymbols(customDFSymbol);
		
		this.fmtCumCost = new DecimalFormat("#,##0 �");
		this.fmtCumCost.setDecimalFormatSymbols(customDFSymbol);
		
		this.fmtProductEnergy = new DecimalFormat("#,##0.0 kWh/u");
		this.fmtProductEnergy.setDecimalFormatSymbols(customDFSymbol);
		
		this.fmtProductCost = new DecimalFormat("#,##0.00 �/u");
		this.fmtProductCost.setDecimalFormatSymbols(customDFSymbol);
		
		this.fmtNumberAccidents = new DecimalFormat("#,##0 acc");
		this.fmtNumberAccidents.setDecimalFormatSymbols(customDFSymbol);
		
	}

	// gets & sets

	public double getCurrProductionRate() {
		return currProductionRate;
	}

	public double getCurrPower() {
		return currPower;
	}

	public double getTotalRate() {
		return totalRate;
	}
	
	public double getSetpointRate() {
		return setpointRate;
	}

	public double getCumProduction() {
		return cumProduction;
	}

	public double getCumEnergy() {
		return cumEnergy;
	}

	public double getCumCost() {
		return cumCost;
	}

	public double getProductEnergy() {
		return productEnergy;
	}

	public double getProductCost() {
		return productCost;
	}
	
	public int getNumberAccidents() {
		return numberAccidents;
	}

	public String getCurrPowerString() {
		return this.fmtCurrPower.format( this.currPower/1000 );
	}

	public String getCumEnergyString() {
		return this.fmtCumEnergy.format( this.cumEnergy/1000 );
	}

	public String getCumCostString() {
		return this.fmtCumCost.format( this.cumCost );
	}

	public String getProductEnergyString() {
		return this.fmtProductEnergy.format( this.productEnergy );
	}

	public String getProductCostString() {
		return this.fmtProductCost.format( this.productCost );
	}
	
	public String getNumberAccidentsString() {
		return this.fmtNumberAccidents.format( this.numberAccidents );
	}

	public int getCurrShiftTimeMinutes() {
		return this.currShiftTimeMinutes;
	}

	public Vector<Workarea> getWorkareas() {
		return this.workareas;
	}

	public Vector<Unit> getUnits() {
		return this.units;
	}

	public Vector<Actor> getActors() {
		return this.actors;
	}

	public Simulator getParent() {
		return this.parent;
	}

	//--

	public void setCurrProductionRate(double currProductionRate) {
		this.currProductionRate = currProductionRate;
		return;
	}
	
	public void setTotalRate(double totalRate) {
		this.totalRate = totalRate;
		return;
	}
	
	public void setSetPointRate(double setpointRate) {
		this.setpointRate = setpointRate;
		return;
	}

	public void setCurrPower(double currPower) {
		this.currPower = currPower;
		return;
	}

	public void setCumProduction(double cumProduction) {
		this.cumProduction = cumProduction;
		return;
	}

	public void setCumEnergy(double cumEnergy) {
		this.cumEnergy = cumEnergy;
		return;
	}

	public void setCumCost(double cumCost) {
		this.cumCost = cumCost;
		return;
	}

	public void setProductEnergy(double productEnergy) {
		this.productEnergy = productEnergy;
		return;
	}

	public void setProductCost(double productCost) {
		this.productCost = productCost;
		return;
	}

	public void setNumberAccidents(int numberAccidents) {
		this.numberAccidents = numberAccidents;
		return;
	}

	// Plant model definition

	private void defineWorkareas() {
		this.workareas = new Vector<Workarea>();
		// row 2
		this.workareas.add( new Workarea( this, 22, 0 ) );
		this.workareas.add( new Workarea( this, 24, 3 ) );
		this.workareas.add( new Workarea( this, 26, 6 ) );
		this.workareas.add( new Workarea( this, 28, 9 ) );
		// row 4
		this.workareas.add( new Workarea( this, 42, 12 ) );
		this.workareas.add( new Workarea( this, 44, 15 ) );
		this.workareas.add( new Workarea( this, 46, 18 ) );
		this.workareas.add( new Workarea( this, 48, 21 ) );
		// row 6
		this.workareas.add( new Workarea( this, 62, 24 ) );
		this.workareas.add( new Workarea( this, 64, 27 ) );
		this.workareas.add( new Workarea( this, 66, 30 ) );
		this.workareas.add( new Workarea( this, 68, 33 ) );
		// row 8
		this.workareas.add( new Workarea( this, 82, 36 ) );
		this.workareas.add( new Workarea( this, 84, 39 ) );
		this.workareas.add( new Workarea( this, 86, 42 ) );
		this.workareas.add( new Workarea( this, 88, 45 ) );
		//
		return; 
	}

	private void defineUnits() {
		this.units = new Vector<Unit>();
		// SUB UNITS A
		// row 2
		this.units.add( new Unit( 221, Const.UNIT_A1, 22 ) );
		this.units.add( new Unit( 241, Const.UNIT_A2, 24 ) );
		this.units.add( new Unit( 261, Const.UNIT_A1, 26 ) );
		this.units.add( new Unit( 281, Const.UNIT_A3, 28 ) );
		// row 4
		this.units.add( new Unit( 421, Const.UNIT_A2, 42 ) );
		this.units.add( new Unit( 441, Const.UNIT_A1, 44 ) );
		this.units.add( new Unit( 461, Const.UNIT_A2, 46 ) );
		this.units.add( new Unit( 481, Const.UNIT_A3, 48 ) );
		// row 6
		this.units.add( new Unit( 621, Const.UNIT_A3, 62 ) );
		this.units.add( new Unit( 641, Const.UNIT_A2, 64 ) );
		this.units.add( new Unit( 661, Const.UNIT_A1, 66 ) );
		this.units.add( new Unit( 681, Const.UNIT_A2, 68 ) );
		// row 8
		this.units.add( new Unit( 821, Const.UNIT_A3, 82 ) );
		this.units.add( new Unit( 841, Const.UNIT_A1, 84 ) );
		this.units.add( new Unit( 861, Const.UNIT_A3, 86 ) );
		this.units.add( new Unit( 881, Const.UNIT_A1, 88 ) );
		// SUB UNITS B
		// row 2
		this.units.add( new Unit( 222, Const.UNIT_B2, 22 ) );
		this.units.add( new Unit( 242, Const.UNIT_B1, 24 ) );
		this.units.add( new Unit( 262, Const.UNIT_B2, 26 ) );
		this.units.add( new Unit( 282, Const.UNIT_B2, 28 ) );
		// row 4
		this.units.add( new Unit( 422, Const.UNIT_B1, 42 ) );
		this.units.add( new Unit( 442, Const.UNIT_B3, 44 ) );
		this.units.add( new Unit( 462, Const.UNIT_B1, 46 ) );
		this.units.add( new Unit( 482, Const.UNIT_B2, 48 ) );
		// row 6
		this.units.add( new Unit( 622, Const.UNIT_B1, 62 ) );
		this.units.add( new Unit( 642, Const.UNIT_B3, 64 ) );
		this.units.add( new Unit( 662, Const.UNIT_B2, 66 ) );
		this.units.add( new Unit( 682, Const.UNIT_B3, 68 ) );
		// row 8
		this.units.add( new Unit( 822, Const.UNIT_B1, 82 ) );
		this.units.add( new Unit( 842, Const.UNIT_B3, 84 ) );
		this.units.add( new Unit( 862, Const.UNIT_B2, 86 ) );
		this.units.add( new Unit( 882, Const.UNIT_B3, 88 ) );
		// SUB UNITS C
		// row 2
		this.units.add( new Unit( 223, Const.UNIT_C3, 22 ) );
		this.units.add( new Unit( 243, Const.UNIT_C1, 24 ) );
		this.units.add( new Unit( 263, Const.UNIT_C1, 26 ) );
		this.units.add( new Unit( 283, Const.UNIT_C1, 28 ) );
		// row 4
		this.units.add( new Unit( 423, Const.UNIT_C2, 42 ) );
		this.units.add( new Unit( 443, Const.UNIT_C3, 44 ) );
		this.units.add( new Unit( 463, Const.UNIT_C3, 46 ) );
		this.units.add( new Unit( 483, Const.UNIT_C3, 48 ) );
		// row 6
		this.units.add( new Unit( 623, Const.UNIT_C2, 62 ) );
		this.units.add( new Unit( 643, Const.UNIT_C2, 64 ) );
		this.units.add( new Unit( 663, Const.UNIT_C2, 66 ) );
		this.units.add( new Unit( 683, Const.UNIT_C1, 68 ) );
		// row 8
		this.units.add( new Unit( 823, Const.UNIT_C3, 82 ) );
		this.units.add( new Unit( 843, Const.UNIT_C2, 84 ) );
		this.units.add( new Unit( 863, Const.UNIT_C3, 86 ) );
		this.units.add( new Unit( 883, Const.UNIT_C1, 88 ) );
		//
		this.initUnitsTechnology();
		this.updateUnitsCurveModels();
		//
		return;
	}

	private void installUnits2Workareas() {

		for( int i = 0; i < this.units.size(); i++ ) {
			int auxUnitWaId = this.units.get(i).getWorkareaId();
			for( int j = 0; j < this.workareas.size(); j++ ) {
				if ( this.workareas.get(j).getId() == auxUnitWaId )	{
					int unitMasterType = ( this.units.get(i).getType() / 10 );
					switch(unitMasterType) {
					case Const.UNIT_A:
						this.workareas.get(j).setUnitA( this.units.get(i) );						
						break;
					case Const.UNIT_B:
						this.workareas.get(j).setUnitB( this.units.get(i) );
						break;
					case Const.UNIT_C:
						this.workareas.get(j).setUnitC( this.units.get(i) );
						break;
					default:
						System.out.println("Unidentified UNIT TYPE : see method : PlantModel.installUnits2Workareas()");
					}
					this.units.get(i).setParent( this.workareas.get(j) );
					break; // exit the for cycle and proceed to the next unit	
				}
			}
		}
		return;
	}

	private void defineActors() {		
		this.actors = new Vector<Actor>();
		//--
		int i = 1;
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AA",  0) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AB",  7) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AC", 34) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AD", 26) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AE", 41) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AF", 23) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AG", 47) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AH", 25) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AI", 44) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AJ", 24) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AK", 42) );
		actors.add( new Actor( Const.ACTOR_TYPE_A + i++, "AL",  8) );
		//--
		i = 1;
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BA", 01) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BB", 06) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BC", 17) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BD", 32) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BE", 40) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BF", 16) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BG", 18) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BH", 27) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BI", 39) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BJ", 15) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BK", 31) );
		actors.add( new Actor( Const.ACTOR_TYPE_B + i++, "BL",  9) );
		//--
		i = 1;
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CA",  2) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CB",  5) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CC", 28) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CD", 33) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CE", 30) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CF", 14) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CG", 19) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CH", 35) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CI", 36) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CJ", 13) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CK", 29) );
		actors.add( new Actor( Const.ACTOR_TYPE_C + i++, "CL", 10) );
		//--
		i = 1;
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DA",  3) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DB",  4) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DC", 43) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DD", 20) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DE", 45) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DF", 21) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DG", 22) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DH", 38) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DI", 46) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DJ", 12) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DK", 37) );
		actors.add( new Actor( Const.ACTOR_TYPE_D + i++, "DL", 11) );
		//
		this.updateExpertiseModels();
		//--
		return;
	}
	
	private void installActors2Workareas() {
		for(int i = 0; i < this.actors.size(); i++) {
			for (int j = 0; j < this.workareas.size(); j++) {
				if ( this.actors.get(i).getLocationIndex() == this.workareas.get(j).getWorkLocationIndex() ) {
					this.workareas.get(j).setCurrActor( this.actors.get(i) );
				}
			}
		}
		return;
	}

} // EOF
