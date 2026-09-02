package com.inknow.manusim.setup;

import java.awt.Font;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;

import java.util.Vector;

import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;

import com.inknow.manusim.control.Const;
import com.inknow.manusim.control.ControlFrame;
import com.inknow.manusim.model.ExponentialModel;
import com.inknow.manusim.model.ParabolicModel;

public class SetupUnits extends JPanel implements ActionListener {

	private static final long serialVersionUID = 1L;
	//
	private ControlFrame parent;
	//
	private Vector<JButton> powerRateButton = new Vector<JButton>();
	private Vector<JButton> efficiencyRawButton = new Vector<JButton>();
	private Vector<JButton> efficiencyTemperatureButton = new Vector<JButton>();
	private Vector<JButton> wearRawButton = new Vector<JButton>();
	private Vector<JButton> efficiencyExpertiseButton = new Vector<JButton>();
	private Vector<JButton> wearExpertiseButton = new Vector<JButton>();
	//
	// Preset standard models to select from
	private Vector<ParabolicModel> powerRateStdModels = new Vector<ParabolicModel>(); // power x rate function - Unit A
	private Vector<ParabolicModel> concaveStdModels = new Vector<ParabolicModel>();	  // efficiency x temperature - Unit C [+] efficiency x raw - Unit A
	private Vector<ParabolicModel> convexStdModels = new Vector<ParabolicModel>();	  // wear x raw curves - Unit C
	private Vector<ExponentialModel> exponentialUpStdModels = new Vector<ExponentialModel>(); // efficiency x expertise - Unit B
	private Vector<ExponentialModel> exponentialDwnStdModels = new Vector<ExponentialModel>(); // wear x expertise - Unit C
	//
	// Unit-s models - Vectors dimension N_UNIT_TYPES
	private Vector<ParabolicModel> unitApowerRateModels = new Vector<ParabolicModel>();
	private Vector<ParabolicModel> unitAefficiencyRawModels = new Vector<ParabolicModel>();
	private Vector<ParabolicModel> unitCefficiencyTemperatureModels = new Vector<ParabolicModel>();
	private Vector<ParabolicModel> unitCwearRawModels = new Vector<ParabolicModel>();
	private Vector<ExponentialModel> unitBefficiencyExpertiseModels = new Vector<ExponentialModel>();
	private Vector<ExponentialModel> unitCwearExpertiseModels = new Vector<ExponentialModel>();

	// constructors

	public SetupUnits() {
		super();
		this.parent = new ControlFrame();
	}

	public SetupUnits(ControlFrame parent) {
		super();
		this.parent = parent;
		this.defineStandardModels();
		this.initComponents();
	}

	// other methods

	private void initComponents() {

		this.setLayout(null);
		this.setBackground(java.awt.SystemColor.control);

		int xLeft = 50;
		int yTop = 30;

		JLabel aux1Label = new JLabel("(Power) x (Production Rate) Curves", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft, yTop, 315, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 12) );
		this.add( aux1Label );

		for(int i=0; i < Const.N_UNIT_TYPES; i++) {
			aux1Label = new JLabel("A"+String.valueOf(i+1), SwingConstants.CENTER);
			aux1Label.setBounds(xLeft + 105*i, yTop + 30, 100, 30);
			aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
			this.add( aux1Label );

			JButton auxCurvePic = new JButton();
			this.powerRateButton.add(auxCurvePic);
			auxCurvePic.setIcon( new javax.swing.ImageIcon( this.unitApowerRateModels.get(i).getPlotFilename() ));
			auxCurvePic.setBounds(xLeft + 105*i, yTop + 60, 100, 100);	
			auxCurvePic.addActionListener(this);
			this.add( auxCurvePic, 0 );
		}

		xLeft = 450;
		yTop = 30;

		aux1Label = new JLabel("(Efficiency) x (Raw Material Quality) Curves", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft, yTop, 315, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 12) );
		this.add( aux1Label );

		for(int i=0; i < Const.N_UNIT_TYPES; i++) {
			aux1Label = new JLabel("A"+String.valueOf(i+1), SwingConstants.CENTER);
			aux1Label.setBounds(xLeft + 105*i, yTop + 30, 100, 30);
			aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
			this.add( aux1Label );

			JButton auxCurvePic = new JButton();
			this.efficiencyRawButton.add(auxCurvePic);
			auxCurvePic.setIcon( new javax.swing.ImageIcon( this.unitAefficiencyRawModels.get(i).getPlotFilename() ));
			auxCurvePic.setBounds(xLeft + 105*i, yTop + 60, 100, 100);	
			auxCurvePic.addActionListener(this);
			this.add( auxCurvePic, 0 );
		}

		xLeft = 50;
		yTop = 230;

		aux1Label = new JLabel("(Efficiency) x (Temperature) Curves", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft, yTop, 315, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 12) );
		this.add( aux1Label );

		for(int i=0; i < Const.N_UNIT_TYPES; i++) {
			aux1Label = new JLabel("C"+String.valueOf(i+1), SwingConstants.CENTER);
			aux1Label.setBounds(xLeft + 105*i, yTop + 30, 100, 30);
			aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
			this.add( aux1Label );

			JButton auxCurvePic = new JButton();
			this.efficiencyTemperatureButton.add(auxCurvePic);
			auxCurvePic.setIcon( new javax.swing.ImageIcon( this.unitCefficiencyTemperatureModels.get(i).getPlotFilename() ));
			auxCurvePic.setBounds(xLeft + 105*i, yTop + 60, 100, 100);	
			auxCurvePic.addActionListener(this);
			this.add( auxCurvePic, 0 );
		}

		xLeft = 450;
		yTop = 230;

		aux1Label = new JLabel("(Wear) x (Raw Material Quality) Curves", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft, yTop, 315, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 12) );
		this.add( aux1Label );

		for(int i=0; i < Const.N_UNIT_TYPES; i++) {
			aux1Label = new JLabel("C"+String.valueOf(i+1), SwingConstants.CENTER);
			aux1Label.setBounds(xLeft + 105*i, yTop + 30, 100, 30);
			aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
			this.add( aux1Label );

			JButton auxCurvePic = new JButton();
			this.wearRawButton.add(auxCurvePic);
			auxCurvePic.setIcon( new javax.swing.ImageIcon( this.unitCwearRawModels.get(i).getPlotFilename() ));
			auxCurvePic.setBounds(xLeft + 105*i, yTop + 60, 100, 100);	
			auxCurvePic.addActionListener(this);
			this.add( auxCurvePic, 0 );
		}

		xLeft = 50;
		yTop = 430;

		aux1Label = new JLabel("(Efficiency) x (Expertise) Curves", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft, yTop, 315, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 12) );
		this.add( aux1Label );

		for(int i=0; i < Const.N_UNIT_TYPES; i++) {
			aux1Label = new JLabel("B"+String.valueOf(i+1), SwingConstants.CENTER);
			aux1Label.setBounds(xLeft + 105*i, yTop + 30, 100, 30);
			aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
			this.add( aux1Label );

			JButton auxCurvePic = new JButton();
			this.efficiencyExpertiseButton.add(auxCurvePic);
			auxCurvePic.setIcon( new javax.swing.ImageIcon( this.unitBefficiencyExpertiseModels.get(i).getPlotFilename() ));
			auxCurvePic.setBounds(xLeft + 105*i, yTop + 60, 100, 100);	
			auxCurvePic.addActionListener(this);
			this.add( auxCurvePic, 0 );
		}

		xLeft = 450;
		yTop = 430;

		aux1Label = new JLabel("(Wear) x (Expertise) Curves", SwingConstants.CENTER);
		aux1Label.setBounds(xLeft, yTop, 315, 30);
		aux1Label.setFont( new Font("Arial", Font.BOLD, 12) );
		this.add( aux1Label );

		for(int i=0; i < Const.N_UNIT_TYPES; i++) {
			aux1Label = new JLabel("C"+String.valueOf(i+1), SwingConstants.CENTER);
			aux1Label.setBounds(xLeft + 105*i, yTop + 30, 100, 30);
			aux1Label.setFont( new Font("Asimov", Font.PLAIN, 14) );
			this.add( aux1Label );

			JButton auxCurvePic = new JButton();
			this.wearExpertiseButton.add(auxCurvePic);
			auxCurvePic.setIcon( new javax.swing.ImageIcon( this.unitCwearExpertiseModels.get(i).getPlotFilename() ));
			auxCurvePic.setBounds(xLeft + 105*i, yTop + 60, 100, 100);	
			auxCurvePic.addActionListener(this);
			this.add( auxCurvePic, 0 );
		}
		//
		this.parent.getMainTabbedPane().addTab("Units", this );
	}
	
	// get buttons

	public Vector<JButton> getPowerRateButton() {
		return powerRateButton;
	}

	public Vector<JButton> getEfficiencyRawButton() {
		return efficiencyRawButton;
	}

	public Vector<JButton> getEfficiencyTemperatureButton() {
		return efficiencyTemperatureButton;
	}

	public Vector<JButton> getWearRawButton() {
		return wearRawButton;
	}

	public Vector<JButton> getEfficiencyExpertiseButton() {
		return efficiencyExpertiseButton;
	}

	public Vector<JButton> getWearExpertiseButton() {
		return wearExpertiseButton;
	}
	
	// get std models

	public Vector<ParabolicModel> getPowerRateStdModels() {
		return this.powerRateStdModels;
	}

	public Vector<ParabolicModel> getConcaveStdModels() {
		return this.concaveStdModels;
	}

	public Vector<ParabolicModel> getConvexStdModels() {
		return this.convexStdModels;
	}

	public Vector<ExponentialModel> getExponentialUpStdModels() {
		return this.exponentialUpStdModels;
	}

	public Vector<ExponentialModel> getExponentialDwnStdModels() {
		return this.exponentialDwnStdModels;
	}
	
	// get models index by id
	
	public int getPowerRateStdModelIndexById(int id) {
		for (int i = 0; i < this.powerRateStdModels.size(); i++) {
			if (this.powerRateStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}

	public int getConcaveStdModelIndexById(int id) {
		for (int i = 0; i < this.concaveStdModels.size(); i++) {
			if (this.concaveStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}

	public int getConvexStdModelIndexById(int id) {
		for (int i = 0; i < this.convexStdModels.size(); i++) {
			if (this.convexStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}

	public int getExponentialUpStdModelIndexById(int id) {
		for (int i = 0; i < this.exponentialUpStdModels.size(); i++) {
			if (this.exponentialUpStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}

	public int getExponentialDwnStdModelIndexById(int id) {
		for (int i = 0; i < this.exponentialDwnStdModels.size(); i++) {
			if (this.exponentialDwnStdModels.get(i).getId() == id) {
				return i;
			}
		}
		return Const.ERROR_CODE;
	}

	// get units models
	
	public Vector<ParabolicModel> getUnitAPowerRateModels() {
		return this.unitApowerRateModels;
	}

	public Vector<ParabolicModel> getUnitAefficiencyRawModels() {
		return this.unitAefficiencyRawModels;
	}

	public Vector<ParabolicModel> getUnitCefficiencyTemperatureModels() {
		return this.unitCefficiencyTemperatureModels;
	}
	
	public Vector<ParabolicModel> getUnitCwearRawModels() {
		return this.unitCwearRawModels;
	}
	
	public Vector<ExponentialModel> getUnitBefficiencyExpertiseModels() {
		return this.unitBefficiencyExpertiseModels;
	}

	public Vector<ExponentialModel> getUnitCwearExpertiseModels() {
		return this.unitCwearExpertiseModels;
	}
	
	// define std models
	
	private void defineStandardModels() {

		// Base curve models :: power x rate function - Unit A
		this.powerRateStdModels.add(0, new ParabolicModel(10, 0.0, 0.25, "pics/ModelPower025.png" ));
		this.powerRateStdModels.add(1, new ParabolicModel(11, 0.0, 0.40, "pics/ModelPower040.png" ));
		this.powerRateStdModels.add(2, new ParabolicModel(12, 0.0, 0.50, "pics/ModelPower050.png" ));
		this.powerRateStdModels.add(3, new ParabolicModel(13, 0.0, 0.60, "pics/ModelPower060.png" ));
		this.powerRateStdModels.add(4, new ParabolicModel(14, 0.0, 0.75, "pics/ModelPower075.png" ));

		// ^ shape function :: efficiency x temperature - Unit C [+] efficiency x raw - Unit A
		this.concaveStdModels.add(0, new ParabolicModel(20, 1.0, "pics/ModelConcave100.png" ));
		this.concaveStdModels.add(1, new ParabolicModel(21, 0.8, "pics/ModelConcave080.png" ));
		this.concaveStdModels.add(2, new ParabolicModel(22, 0.6, "pics/ModelConcave060.png" ));
		this.concaveStdModels.add(3, new ParabolicModel(23, 0.4, "pics/ModelConcave040.png" ));
		
		// V shape function :: wear x raw curves - Unit C
		this.convexStdModels.add(0, new ParabolicModel(30, 1.0, "pics/ModelConvex000.png" ));
		this.convexStdModels.add(1, new ParabolicModel(31, 0.8, "pics/ModelConvex020.png" ));
		this.convexStdModels.add(2, new ParabolicModel(32, 0.6, "pics/ModelConvex040.png" ));
		this.convexStdModels.add(3, new ParabolicModel(33, 0.4, "pics/ModelConvex060.png" ));

		// Sensitivity curve models :: efficiency x expertise - Unit B
		this.exponentialUpStdModels.add(0, new ExponentialModel(40, 1.00, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth100.png" ));
		this.exponentialUpStdModels.add(1, new ExponentialModel(41, 0.80, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth080.png" ));
		this.exponentialUpStdModels.add(2, new ExponentialModel(42, 0.66, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth066.png" ));
		this.exponentialUpStdModels.add(3, new ExponentialModel(43, 0.50, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelGrowth050.png" ));
		
		// Sensitivity curve models :: efficiency x expertise - Unit B
		this.exponentialDwnStdModels.add(0, new ExponentialModel(50, 1 - 0.00, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelFall000.png" ));
		this.exponentialDwnStdModels.add(1, new ExponentialModel(51, 1 - 0.20, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelFall020.png" ));
		this.exponentialDwnStdModels.add(2, new ExponentialModel(52, 1 - 0.33, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelFall033.png" ));
		this.exponentialDwnStdModels.add(3, new ExponentialModel(53, 1 - 0.50, Const.EXPONENTIAL_MODEL_GROWTH, "pics/ModelFall050.png" ));

		// Unit A + B + C models
		for (int i = 0; i < Const.N_UNIT_TYPES; i++) {
			this.unitApowerRateModels.add(i, this.powerRateStdModels.get( Const.UNIT_POWER_RATE_MODEL_INDEX ));
			this.unitAefficiencyRawModels.add(i, this.concaveStdModels.get( Const.UNIT_EFFICIENCY_RAW_MODEL_INDEX ));
			this.unitCefficiencyTemperatureModels.add(i, this.concaveStdModels.get( Const.UNIT_EFFICIENCY_TEMPERATURE_MODEL_INDEX ));
			this.unitCwearRawModels.add(i, this.convexStdModels.get( Const.UNIT_WEAR_RAW_MODEL_INDEX ));
			this.unitBefficiencyExpertiseModels.add(i, this.exponentialUpStdModels.get( Const.UNIT_EFFICIENCY_EXPERTISE_MODEL_INDEX ));
			this.unitCwearExpertiseModels.add(i, this.exponentialDwnStdModels.get( Const.UNIT_WEAR_EXPERTISE_MODEL_INDEX ));
		}
		return;
	}

	@Override
	public void actionPerformed(ActionEvent e) {
		for(int i=0; i < Const.N_UNIT_TYPES; i++) {
			if (e.getSource() == powerRateButton.get(i)) {
				int index = this.getPowerRateStdModelIndexById( this.unitApowerRateModels.get(i).getId() );
				index++;
				if (index >= this.powerRateStdModels.size()) index = 0;
				this.unitApowerRateModels.set(i, this.powerRateStdModels.get(index) );
				powerRateButton.get(i).setIcon( new javax.swing.ImageIcon( this.unitApowerRateModels.get(i).getPlotFilename() ));
				this.parent.getSimulator().getPlant().updateUnitsCurveModels();
			}
			if (e.getSource() == efficiencyRawButton.get(i)) {
				int index = this.getConcaveStdModelIndexById( this.unitAefficiencyRawModels.get(i).getId() );
				index++;
				if (index >= this.concaveStdModels.size()) index = 0;
				this.unitAefficiencyRawModels.set(i, this.concaveStdModels.get(index) );
				efficiencyRawButton.get(i).setIcon( new javax.swing.ImageIcon( this.unitAefficiencyRawModels.get(i).getPlotFilename() ));
				this.parent.getSimulator().getPlant().updateUnitsCurveModels();
			}
			if (e.getSource() == efficiencyTemperatureButton.get(i)) {
				int index = this.getConcaveStdModelIndexById( this.unitCefficiencyTemperatureModels.get(i).getId() );
				index++;
				if (index >= this.concaveStdModels.size()) index = 0;
				this.unitCefficiencyTemperatureModels.set(i, this.concaveStdModels.get(index) );
				efficiencyTemperatureButton.get(i).setIcon( new javax.swing.ImageIcon( this.unitCefficiencyTemperatureModels.get(i).getPlotFilename() ));
				this.parent.getSimulator().getPlant().updateUnitsCurveModels();
			}
			if (e.getSource() == wearRawButton.get(i)) {
				int index = this.getConvexStdModelIndexById( this.unitCwearRawModels.get(i).getId() );
				index++;
				if (index >= this.convexStdModels.size()) index = 0;
				this.unitCwearRawModels.set(i, this.convexStdModels.get(index) );
				wearRawButton.get(i).setIcon( new javax.swing.ImageIcon( this.unitCwearRawModels.get(i).getPlotFilename() ));
				this.parent.getSimulator().getPlant().updateUnitsCurveModels();
			}
			if (e.getSource() == efficiencyExpertiseButton.get(i)) {
				int index = this.getExponentialUpStdModelIndexById( this.unitBefficiencyExpertiseModels.get(i).getId() );
				index++;
				if (index >= this.exponentialUpStdModels.size()) index = 0;
				this.unitBefficiencyExpertiseModels.set(i, this.exponentialUpStdModels.get(index) );
				efficiencyExpertiseButton.get(i).setIcon( new javax.swing.ImageIcon( this.unitBefficiencyExpertiseModels.get(i).getPlotFilename() ));
				this.parent.getSimulator().getPlant().updateUnitsCurveModels();
			}
			if (e.getSource() == wearExpertiseButton.get(i)) {
				int index = this.getExponentialDwnStdModelIndexById( this.unitCwearExpertiseModels.get(i).getId() );
				index++;
				if (index >= this.exponentialDwnStdModels.size()) index = 0;
				this.unitCwearExpertiseModels.set(i, this.exponentialDwnStdModels.get(index) );
				wearExpertiseButton.get(i).setIcon( new javax.swing.ImageIcon( this.unitCwearExpertiseModels.get(i).getPlotFilename() ));
				this.parent.getSimulator().getPlant().updateUnitsCurveModels();
			}
		}
		return;
	}
}
