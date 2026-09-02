package com.inknow.manusim.model;

import java.text.DecimalFormat;
import java.util.Random;

import com.inknow.manusim.control.Const;

/** Weather is a class to perform several operations related with weather cycles processing.
*
* @author Rui Neves-Silva (UNINOVA - FCT/UNL)
* @version 1.0 Build 0001 Nov-2011/Feb-2013.
*/

public abstract class Weather {

	private static Random rand = new Random();

	/** Seed the weather RNG for reproducible temperature noise. */
	public static void setSeed(long seed) {
		rand.setSeed(seed);
	}

	public static double getAmbTemp(DayTime dayTime) {
		return Math.cos( 2 * Math.PI * ( dayTime.getDayMinute() - ( Const.AMB_TEMPERATURE_PEAK_HH * 60) ) / ( 24 * 60 ) ) * Const.TEMP_AMB_AMP 
						+ Const.TEMP_AMB_AVG + Const.RANDOM_TEMPERATURE * rand.nextGaussian();
	}
	
	public static String getAmbTempString(double ambTemp) {
		DecimalFormat fmt = new DecimalFormat("0 \u00BAC");
		return fmt.format( Math.round( ambTemp ) );
	}
	
}
